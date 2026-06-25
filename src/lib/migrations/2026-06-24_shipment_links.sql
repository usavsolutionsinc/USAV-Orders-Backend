-- ============================================================================
-- 2026-06-24_shipment_links.sql
--
-- Receiving redesign — UNIFIED-LINKAGE pillar (plan: iterative-hopping-dragon).
-- ONE polymorphic owner↔tracking linkage table for BOTH inbound and outbound
-- flows, replacing the two parallel junctions against the single STN master:
--   • receiving_shipments  (PO/carton ↔ tracking, INBOUND, multi-box)
--   • order_shipment_links (order ↔ tracking, OUTBOUND, split shipments)
-- Many-trackings-per-owner for both directions. The is_primary row mirrors the
-- denormalized receiving.shipment_id / orders.shipment_id caches (which STAY).
--
-- Polymorphic owner (owner_type, owner_id): Postgres has no polymorphic FK, so
-- owner_id has NO FK (integrity via the legacy junctions during the bake +
-- cleanup triggers added at the Phase 4 cutover); mirrors photos /
-- work_assignments. shipment_id DOES FK to STN (ON DELETE CASCADE, matching
-- receiving_shipments). STN itself stays the global tracking master.
--
-- TENANT-FROM-BIRTH: organization_id NOT NULL + GUC loud-fail default; per-org
-- keys lead with organization_id. The backfill stamps org explicitly from the
-- source junctions (both already carry organization_id NOT NULL).
--
-- ⚠ RLS ARMED, NOT FORCED — the writer (src/lib/shipping/shipment-links.ts)
-- lands at the linkage cutover (Phase 4); mirrors serial_unit_listings. Joins
-- the FORCE set in a later enforce migration once writers stamp org. RLS is
-- inert under neondb_owner (BYPASSRLS) regardless.
--
-- ROLLBACK: DROP TABLE IF EXISTS shipment_links.
-- VERIFY: row count ≈ count(receiving_shipments)+count(order_shipment_links);
--         at most one is_primary per (org, owner_type, owner_id).
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_links (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  owner_type       text NOT NULL CHECK (owner_type IN ('RECEIVING', 'ORDER')),
  owner_id         integer NOT NULL,
  shipment_id      bigint NOT NULL REFERENCES shipping_tracking_numbers(id) ON DELETE CASCADE,
  box_seq          integer NOT NULL DEFAULT 1,
  is_primary       boolean NOT NULL DEFAULT false,
  direction        text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  role             text,                                 -- PO_ANCHOR | EXTRA_BOX | ORDER_PRIMARY | ORDER_SPLIT
  source           text,                                 -- provenance (carried from order_shipment_links.source)
  linked_by        integer,                              -- staff_id (no FK; mirrors inventory_events.actor_staff_id)
  linked_at        timestamptz NOT NULL DEFAULT now(),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- No duplicate (owner ↔ tracking) link per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_links_owner_shipment
  ON shipment_links (organization_id, owner_type, owner_id, shipment_id);
-- Exactly one primary tracking per owner (mirrors ux_receiving_shipments_primary).
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_links_owner_primary
  ON shipment_links (organization_id, owner_type, owner_id)
  WHERE is_primary;
-- Reverse lookup: tracking → owners.
CREATE INDEX IF NOT EXISTS idx_shipment_links_org_shipment
  ON shipment_links (organization_id, shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_links_shipment
  ON shipment_links (shipment_id);

-- ── Arm RLS (NOT forced; see header caveat) ─────────────────────────────────
ALTER TABLE shipment_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipment_links_tenant_isolation ON shipment_links;
CREATE POLICY shipment_links_tenant_isolation ON shipment_links
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

COMMENT ON TABLE shipment_links IS
  'Unified polymorphic owner↔tracking linkage (inbound + outbound), one row per (owner, shipment). Subsumes receiving_shipments + order_shipment_links; STN stays the tracking master and receiving.shipment_id/orders.shipment_id stay as primary-mirror caches. Receiving redesign / unified-linkage pillar.';

-- ── Backfill (idempotent via ON CONFLICT) ───────────────────────────────────
-- The is_primary dedup window guarantees at most one TRUE primary per owner so
-- the partial-unique index can never be violated even if a source junction held
-- multiple primaries for one owner.

-- Inbound: receiving_shipments → owner_type RECEIVING.
INSERT INTO shipment_links
  (organization_id, owner_type, owner_id, shipment_id, box_seq, is_primary, direction, role, linked_by, linked_at)
SELECT
  organization_id, 'RECEIVING', receiving_id, shipment_id, box_seq,
  is_primary AND row_number() OVER (
    PARTITION BY organization_id, receiving_id, is_primary ORDER BY box_seq, id) = 1,
  'INBOUND',
  CASE WHEN box_seq = 1 OR is_primary THEN 'PO_ANCHOR' ELSE 'EXTRA_BOX' END,
  received_by, COALESCE(received_at, created_at)
FROM receiving_shipments
ON CONFLICT (organization_id, owner_type, owner_id, shipment_id) DO NOTHING;

-- Outbound: order_shipment_links → owner_type ORDER.
INSERT INTO shipment_links
  (organization_id, owner_type, owner_id, shipment_id, box_seq, is_primary, direction, role, source, linked_at)
SELECT
  organization_id, 'ORDER', order_row_id, shipment_id, 1,
  is_primary AND row_number() OVER (
    PARTITION BY organization_id, order_row_id, is_primary ORDER BY created_at, shipment_id) = 1,
  'OUTBOUND',
  CASE WHEN is_primary THEN 'ORDER_PRIMARY' ELSE 'ORDER_SPLIT' END,
  source, created_at
FROM order_shipment_links
ON CONFLICT (organization_id, owner_type, owner_id, shipment_id) DO NOTHING;
