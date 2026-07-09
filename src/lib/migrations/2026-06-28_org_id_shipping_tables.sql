-- ============================================================================
-- 2026-06-28_org_id_shipping_tables.sql   (Phase B — schema coverage, shipping)
--
-- Adds organization_id to the SHIPPING / FBA-fulfillment tables that the prior
-- org_id waves (2026-05-23 business tables, 2026-06-14 needs-col, 2026-06-20
-- final-six) MISSED. A full sweep of the shipping/tracking/FBA domain (see the
-- "Already covered" note below) shows only three tables still carry NO own
-- organization_id column — all three are FBA shipping-label / scan children that
-- predate org-scoping and were never added to any add-column list:
--
--   fba_label_batches       (one shipping label -> bundle of items)
--   fba_label_batch_items   (junction: batch <-> shipment item)
--   fba_scan_events         (immutable FBA scan audit log)
--
-- Each has a CLEAR FK parent that already carries organization_id, so we backfill
-- the column from the parent row's org rather than blanket-stamping USAV:
--   fba_label_batches.shipment_id      -> fba_shipments.organization_id
--   fba_label_batch_items.item_id      -> fba_shipment_items.organization_id
--   fba_scan_events.{shipment_id,item_id,batch_id}
--                                      -> fba_shipments / fba_shipment_items /
--                                         fba_label_batches (first non-null wins)
-- Any straggler with no resolvable parent (e.g. an orphan fba_scan_events row
-- whose shipment/item/batch were all SET NULL) falls back to the USAV tenant —
-- USAV is the only tenant today, so this is equivalent to a parent-derived value.
--
-- ⚠ NULLABLE ON PURPOSE (mirrors 2026-06-14_org_id_phase_b_needs_col, NOT the
--   NOT-NULL domain_children variant): these tables have session-less writers
--   (FBA label-printing / scan-bench flows) that are NOT yet threaded through
--   withTenantTransaction. A NOT NULL + GUC-only default would loud-fail those
--   inserts (no GUC set). So the column is NULLABLE and its DEFAULT is the
--   transitional COALESCE(GUC, USAV) — a session-less owner-pool insert lands a
--   USAV row instead of a NULL-org row, and a GUC-scoped insert stamps the real
--   org. (This is the same "transitional USAV-fallback default" that
--   relax_tenant_isolation() restores in 2026-06-14_rls_enforcement_infra.sql.)
--
-- ⚠ ADDITIVE / UNAPPLIED / MUST PRECEDE FORCE. This file only adds the column +
--   backfill + GUC/USAV default + FK + index, and ARMS (ENABLE) a canonical RLS
--   policy. It does NOT call enforce_tenant_isolation() (FORCE) — under the
--   current neondb_owner (rolbypassrls = true) connection ENABLE ROW LEVEL
--   SECURITY grants ZERO isolation; this is correctness SCAFFOLDING only. Real
--   isolation begins once the non-BYPASSRLS app_tenant role is live, the
--   session-less writers above are threaded, the column is flipped to NOT NULL,
--   and enforce_tenant_isolation() FORCEs each table (a later dated migration).
--
-- Already covered (verified against migrations 2026-05-23 / 2026-06-14 / 2026-06-20
-- and the 2026-06-22..2026-06-28 enforce waves — these already HAVE the column,
-- DO NOT re-add): fba_shipments, fba_shipment_items, fba_shipment_item_units,
-- fba_tracking_item_allocations, fba_fnskus, fba_fnsku_logs, shipment_orders,
-- order_shipment_links, shipment_links, shipment_tracking_events,
-- shipping_tracking_numbers, tracking_exceptions, receiving_shipments, packages.
--
-- Idempotent (IF [NOT] EXISTS / guarded DO-blocks throughout) and roll-forward
-- only. The USAV tenant id below matches USAV_ORG_ID in src/lib/tenancy/constants.ts.
-- ============================================================================

-- ── fba_label_batches ───────────────────────────────────────────────────────
-- Parent: shipment_id (NOT NULL) -> fba_shipments.organization_id.
DO $$
DECLARE
  table_exists boolean;
  col_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fba_label_batches'
  ) INTO table_exists;
  IF NOT table_exists THEN
    RAISE NOTICE 'skipping fba_label_batches — table does not exist';
    RETURN;
  END IF;

  -- 1. Add the column (NULLABLE — see header). Skip if already present.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fba_label_batches'
      AND column_name = 'organization_id'
  ) INTO col_exists;
  IF NOT col_exists THEN
    ALTER TABLE fba_label_batches ADD COLUMN organization_id uuid;
    RAISE NOTICE 'added organization_id to fba_label_batches';
  END IF;

  -- 2. Backfill from the parent shipment's org.
  UPDATE fba_label_batches b
     SET organization_id = s.organization_id
    FROM fba_shipments s
   WHERE b.shipment_id = s.id
     AND b.organization_id IS NULL
     AND s.organization_id IS NOT NULL;

  -- 3. Any straggler with no resolvable parent -> USAV (the only tenant today).
  UPDATE fba_label_batches
     SET organization_id = '00000000-0000-0000-0000-000000000001'
   WHERE organization_id IS NULL;

  -- 4. Transitional default: real org from the GUC, else USAV (no NULL-org rows,
  --    no loud-fail for the un-threaded session-less writers).
  ALTER TABLE fba_label_batches
    ALTER COLUMN organization_id SET DEFAULT COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );

  -- 5. FK to organizations(id), RESTRICT on delete (mirrors the parent migrations).
  ALTER TABLE fba_label_batches DROP CONSTRAINT IF EXISTS fba_label_batches_organization_fk;
  ALTER TABLE fba_label_batches ADD CONSTRAINT fba_label_batches_organization_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

  -- 6. Index by org.
  CREATE INDEX IF NOT EXISTS idx_fba_label_batches_organization
    ON fba_label_batches (organization_id);

  -- 7. ENABLE RLS + canonical (non-FORCE) policy. ARMED, NOT ENFORCED — see header.
  ALTER TABLE fba_label_batches ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS fba_label_batches_tenant_isolation ON fba_label_batches;
  CREATE POLICY fba_label_batches_tenant_isolation ON fba_label_batches
    USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
END $$;

-- ── fba_label_batch_items ───────────────────────────────────────────────────
-- Parent: item_id (NOT NULL) -> fba_shipment_items.organization_id.
DO $$
DECLARE
  table_exists boolean;
  col_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fba_label_batch_items'
  ) INTO table_exists;
  IF NOT table_exists THEN
    RAISE NOTICE 'skipping fba_label_batch_items — table does not exist';
    RETURN;
  END IF;

  -- 1. Add the column (NULLABLE — see header). Skip if already present.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fba_label_batch_items'
      AND column_name = 'organization_id'
  ) INTO col_exists;
  IF NOT col_exists THEN
    ALTER TABLE fba_label_batch_items ADD COLUMN organization_id uuid;
    RAISE NOTICE 'added organization_id to fba_label_batch_items';
  END IF;

  -- 2. Backfill from the parent shipment-item's org (item_id is NOT NULL).
  UPDATE fba_label_batch_items i
     SET organization_id = si.organization_id
    FROM fba_shipment_items si
   WHERE i.item_id = si.id
     AND i.organization_id IS NULL
     AND si.organization_id IS NOT NULL;

  -- 2b. Defensive fallback via the batch parent (covers any row whose item_id
  --     parent had a NULL org for some reason).
  UPDATE fba_label_batch_items i
     SET organization_id = b.organization_id
    FROM fba_label_batches b
   WHERE i.batch_id = b.id
     AND i.organization_id IS NULL
     AND b.organization_id IS NOT NULL;

  -- 3. Any straggler -> USAV.
  UPDATE fba_label_batch_items
     SET organization_id = '00000000-0000-0000-0000-000000000001'
   WHERE organization_id IS NULL;

  -- 4. Transitional default (GUC, else USAV).
  ALTER TABLE fba_label_batch_items
    ALTER COLUMN organization_id SET DEFAULT COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );

  -- 5. FK to organizations(id).
  ALTER TABLE fba_label_batch_items DROP CONSTRAINT IF EXISTS fba_label_batch_items_organization_fk;
  ALTER TABLE fba_label_batch_items ADD CONSTRAINT fba_label_batch_items_organization_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

  -- 6. Index by org.
  CREATE INDEX IF NOT EXISTS idx_fba_label_batch_items_organization
    ON fba_label_batch_items (organization_id);

  -- 7. ENABLE RLS + canonical (non-FORCE) policy. ARMED, NOT ENFORCED.
  ALTER TABLE fba_label_batch_items ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS fba_label_batch_items_tenant_isolation ON fba_label_batch_items;
  CREATE POLICY fba_label_batch_items_tenant_isolation ON fba_label_batch_items
    USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
END $$;

-- ── fba_scan_events ─────────────────────────────────────────────────────────
-- Parents are all NULLABLE (ON DELETE SET NULL): shipment_id -> fba_shipments,
-- item_id -> fba_shipment_items, batch_id -> fba_label_batches. Resolve from the
-- first non-null parent; orphans fall back to USAV.
DO $$
DECLARE
  table_exists boolean;
  col_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fba_scan_events'
  ) INTO table_exists;
  IF NOT table_exists THEN
    RAISE NOTICE 'skipping fba_scan_events — table does not exist';
    RETURN;
  END IF;

  -- 1. Add the column (NULLABLE — see header). Skip if already present.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fba_scan_events'
      AND column_name = 'organization_id'
  ) INTO col_exists;
  IF NOT col_exists THEN
    ALTER TABLE fba_scan_events ADD COLUMN organization_id uuid;
    RAISE NOTICE 'added organization_id to fba_scan_events';
  END IF;

  -- 2. Backfill from the shipment parent (most rows carry a shipment_id).
  UPDATE fba_scan_events e
     SET organization_id = s.organization_id
    FROM fba_shipments s
   WHERE e.shipment_id = s.id
     AND e.organization_id IS NULL
     AND s.organization_id IS NOT NULL;

  -- 2b. Fallback via the shipment-item parent.
  UPDATE fba_scan_events e
     SET organization_id = si.organization_id
    FROM fba_shipment_items si
   WHERE e.item_id = si.id
     AND e.organization_id IS NULL
     AND si.organization_id IS NOT NULL;

  -- 2c. Fallback via the label-batch parent.
  UPDATE fba_scan_events e
     SET organization_id = b.organization_id
    FROM fba_label_batches b
   WHERE e.batch_id = b.id
     AND e.organization_id IS NULL
     AND b.organization_id IS NOT NULL;

  -- 3. Orphan rows (all parents SET NULL) -> USAV.
  UPDATE fba_scan_events
     SET organization_id = '00000000-0000-0000-0000-000000000001'
   WHERE organization_id IS NULL;

  -- 4. Transitional default (GUC, else USAV).
  ALTER TABLE fba_scan_events
    ALTER COLUMN organization_id SET DEFAULT COALESCE(
      NULLIF(current_setting('app.current_org', true), '')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );

  -- 5. FK to organizations(id).
  ALTER TABLE fba_scan_events DROP CONSTRAINT IF EXISTS fba_scan_events_organization_fk;
  ALTER TABLE fba_scan_events ADD CONSTRAINT fba_scan_events_organization_fk
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;

  -- 6. Index by org.
  CREATE INDEX IF NOT EXISTS idx_fba_scan_events_organization
    ON fba_scan_events (organization_id);

  -- 7. ENABLE RLS + canonical (non-FORCE) policy. ARMED, NOT ENFORCED.
  ALTER TABLE fba_scan_events ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS fba_scan_events_tenant_isolation ON fba_scan_events;
  CREATE POLICY fba_scan_events_tenant_isolation ON fba_scan_events
    USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
END $$;
