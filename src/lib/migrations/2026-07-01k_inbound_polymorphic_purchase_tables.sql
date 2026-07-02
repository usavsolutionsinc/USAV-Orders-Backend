-- ============================================================================
-- 2026-07-01k_inbound_polymorphic_purchase_tables.sql
--
-- Universal Incoming — Phase 1 (polymorphic purchase identity).
-- Plan: docs/incoming-universal-purchase-orders-plan.md §3 (Polymorphic DB design).
-- Contract: .claude/rules/polymorphic-tables.md (ratified 2026-07-01).
--
-- Makes receiving_lines the ONE Incoming spine and moves external purchase
-- identity off the spine into polymorphic side-tables, so every source (Zoho,
-- eBay buyer purchases, future channels) shares one queue and one dedup model:
--
--   inbound_purchase_order_links        — (source_type, source_order_id,
--                                          source_line_item_id) per line. The
--                                          purchase-identity SoT. A merged
--                                          eBay+Zoho purchase is TWO link rows on
--                                          ONE receiving_line, not two spine rows.
--   inbound_purchase_order_mirror       — one read-only upstream reconcile mirror
--                                          for ALL sources (replaces per-channel
--                                          mirror tables; zoho_po_mirror keeps
--                                          running during the dual-write transition).
--   inbound_purchase_order_equivalence  — cross-source dedup graph: records
--                                          "eBay order X ≡ Zoho PO Y" once, with a
--                                          canonical LEAST/GREATEST pair key so
--                                          (ebay,zoho) and (zoho,ebay) can't both exist.
--   inbound_purchase_merge_log          — audit of every spine-row merge.
--
-- POLYMORPHIC CONTRACT (all four):
--   • Named CHECK on every source_type discriminator (never free text).
--   • Org-led keys — every unique/partial-unique leads with organization_id.
--   • Tenant-from-birth — organization_id UUID NOT NULL, NO default in the raw
--     DDL; enforce_tenant_isolation() installs the loud-fail GUC default + FORCE
--     RLS + canonical tenant_isolation policy in THIS migration.
--   • Parent-delete integrity — real FK receiving_line_id → receiving_lines(id)
--     ON DELETE CASCADE (the non-polymorphic parent) on links + merge_log.
--   • Drizzle models added in the same PR (src/lib/drizzle/schema.ts).
--
-- FORCE-from-birth (not armed-not-forced like 2026-06-29c): the writers land in
-- the SAME PR (src/lib/inbound/{purchase-links,mirror,equivalence}.ts), all
-- org-scoped via withTenantTransaction, so these tables join the FORCE set now.
-- The k→l→m backfill runs as the BYPASSRLS owner and stamps organization_id
-- explicitly, so FORCE RLS never blocks it.
--
-- ADDITIVE + IDEMPOTENT: pure CREATE … IF NOT EXISTS + guarded CHECK DO-blocks.
-- Nothing reads these until the Phase 1 writers + Phase 3 reader cutover land.
--
-- ROLLBACK:
--   select relax_tenant_isolation('inbound_purchase_merge_log');
--   select relax_tenant_isolation('inbound_purchase_order_equivalence');
--   select relax_tenant_isolation('inbound_purchase_order_mirror');
--   select relax_tenant_isolation('inbound_purchase_order_links');
--   DROP TABLE IF EXISTS inbound_purchase_merge_log,
--     inbound_purchase_order_equivalence, inbound_purchase_order_mirror,
--     inbound_purchase_order_links;
-- ============================================================================

BEGIN;

-- ── inbound_purchase_order_links — polymorphic purchase identity (SoT) ───────
-- One row per (receiving_line, external purchase-order line). is_primary marks
-- the badge/account source shown in Incoming. Merged purchases carry multiple
-- rows on the same receiving_line_id (e.g. ebay is_primary + zoho secondary).
CREATE TABLE IF NOT EXISTS inbound_purchase_order_links (
  id                   BIGSERIAL PRIMARY KEY,
  organization_id      UUID NOT NULL,                 -- no DEFAULT; helper installs the loud-fail GUC default
  receiving_line_id    INTEGER NOT NULL REFERENCES receiving_lines(id) ON DELETE CASCADE,
  source_type          TEXT NOT NULL,                 -- discriminator; named CHECK below
  source_order_id      TEXT NOT NULL,                 -- external PO#/order id (Zoho purchaseorder_id, eBay order id)
  source_line_item_id  TEXT,                          -- external line id, when the source has one
  is_primary           BOOLEAN NOT NULL DEFAULT false,
  platform_account_id  BIGINT REFERENCES platform_accounts(id) ON DELETE SET NULL,
  linked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE inbound_purchase_order_links
    ADD CONSTRAINT inbound_purchase_order_links_source_type_chk
    CHECK (source_type IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The long-term dedup key: one link per (line, external identity) within an org.
-- COALESCE(source_line_item_id,'') so a NULL line id still participates uniquely.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_po_links_natural
  ON inbound_purchase_order_links (
    organization_id, receiving_line_id, source_type, source_order_id,
    COALESCE(source_line_item_id, '')
  );

-- "find the line(s) for this external order" (eBay/Zoho merge matcher).
CREATE INDEX IF NOT EXISTS idx_inbound_po_links_source_lookup
  ON inbound_purchase_order_links (organization_id, source_type, source_order_id);

-- "all links for this line" (Incoming display join + merge).
CREATE INDEX IF NOT EXISTS idx_inbound_po_links_line
  ON inbound_purchase_order_links (organization_id, receiving_line_id);

-- At most one primary link per line (the badge/account source).
CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_po_links_one_primary
  ON inbound_purchase_order_links (organization_id, receiving_line_id)
  WHERE is_primary;

COMMENT ON TABLE inbound_purchase_order_links IS
  'Polymorphic purchase-identity SoT: (receiving_line, source_type, source_order_id, source_line_item_id). A merged eBay+Zoho purchase is multiple link rows on ONE receiving_line, not two spine rows. Universal Incoming Phase 1.';

-- ── inbound_purchase_order_mirror — polymorphic reconcile mirror ─────────────
-- ONE read-only upstream mirror for all sources (never a second queue). Legacy
-- zoho_po_mirror keeps running; Zoho sync dual-writes both until readers cut over.
-- Queryable business facts are real columns; the vendor-specific tail stays in
-- raw_payload jsonb.
CREATE TABLE IF NOT EXISTS inbound_purchase_order_mirror (
  id                      BIGSERIAL PRIMARY KEY,
  organization_id         UUID NOT NULL,
  source_type             TEXT NOT NULL,
  source_order_id         TEXT NOT NULL,
  platform_account_id     BIGINT REFERENCES platform_accounts(id) ON DELETE SET NULL,
  order_number            TEXT,
  vendor_or_seller_name   TEXT,
  status                  TEXT,
  payment_status          TEXT,
  po_date                 DATE,
  expected_delivery_date  DATE,
  tracking_number         TEXT,
  carrier_code            TEXT,
  line_items              JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_payload             JSONB,
  last_modified_at        TIMESTAMPTZ,
  synced_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE inbound_purchase_order_mirror
    ADD CONSTRAINT inbound_purchase_order_mirror_source_type_chk
    CHECK (source_type IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_po_mirror_natural
  ON inbound_purchase_order_mirror (organization_id, source_type, source_order_id);

CREATE INDEX IF NOT EXISTS idx_inbound_po_mirror_account
  ON inbound_purchase_order_mirror (organization_id, platform_account_id)
  WHERE platform_account_id IS NOT NULL;

COMMENT ON TABLE inbound_purchase_order_mirror IS
  'Polymorphic read-only reconcile mirror for ALL inbound sources (replaces per-channel mirror tables). One row per (org, source_type, source_order_id). Queryable facts are real columns; vendor tail in raw_payload. Universal Incoming Phase 1.';

-- ── inbound_purchase_order_equivalence — cross-source dedup graph ────────────
-- Records "these two external orders are the same real-world purchase" once. The
-- writer canonicalizes the pair (a ≤ b by LEAST/GREATEST) so (ebay,zoho) and
-- (zoho,ebay) collapse to one row.
CREATE TABLE IF NOT EXISTS inbound_purchase_order_equivalence (
  id                 BIGSERIAL PRIMARY KEY,
  organization_id    UUID NOT NULL,
  source_type_a      TEXT NOT NULL,
  source_order_id_a  TEXT NOT NULL,
  source_type_b      TEXT NOT NULL,
  source_order_id_b  TEXT NOT NULL,
  link_reason        TEXT NOT NULL,                 -- 'tracking' | 'order_number' | 'manual' | 'fuzzy_sku'
  linked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE inbound_purchase_order_equivalence
    ADD CONSTRAINT inbound_purchase_order_equivalence_type_a_chk
    CHECK (source_type_a IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE inbound_purchase_order_equivalence
    ADD CONSTRAINT inbound_purchase_order_equivalence_type_b_chk
    CHECK (source_type_b IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Order-independent pair uniqueness. Canonical (least, greatest) so a pair is
-- stored once regardless of which side the writer passes first.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_po_equivalence_pair
  ON inbound_purchase_order_equivalence (
    organization_id,
    LEAST(source_type_a, source_type_b),
    LEAST(source_order_id_a, source_order_id_b),
    GREATEST(source_type_a, source_type_b),
    GREATEST(source_order_id_a, source_order_id_b)
  );

CREATE INDEX IF NOT EXISTS idx_inbound_po_equivalence_a
  ON inbound_purchase_order_equivalence (organization_id, source_type_a, source_order_id_a);
CREATE INDEX IF NOT EXISTS idx_inbound_po_equivalence_b
  ON inbound_purchase_order_equivalence (organization_id, source_type_b, source_order_id_b);

COMMENT ON TABLE inbound_purchase_order_equivalence IS
  'Cross-source dedup graph: eBay order ↔ Zoho PO "same real purchase" edges, canonical LEAST/GREATEST pair key so (a,b)/(b,a) collapse. Consulted by the merge algorithm before touching spine rows. Universal Incoming Phase 1.';

-- ── inbound_purchase_merge_log — dedup audit (polymorphic refs) ──────────────
CREATE TABLE IF NOT EXISTS inbound_purchase_merge_log (
  id                        BIGSERIAL PRIMARY KEY,
  organization_id           UUID NOT NULL,
  winner_line_id            INTEGER NOT NULL REFERENCES receiving_lines(id) ON DELETE CASCADE,
  loser_line_id             INTEGER REFERENCES receiving_lines(id) ON DELETE SET NULL,
  merge_reason              TEXT NOT NULL,
  primary_source_type       TEXT NOT NULL,
  primary_source_order_id   TEXT NOT NULL,
  secondary_source_type     TEXT,
  secondary_source_order_id TEXT,
  merged_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  merged_by_staff_id        INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE inbound_purchase_merge_log
    ADD CONSTRAINT inbound_purchase_merge_log_primary_type_chk
    CHECK (primary_source_type IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE inbound_purchase_merge_log
    ADD CONSTRAINT inbound_purchase_merge_log_secondary_type_chk
    CHECK (secondary_source_type IS NULL OR secondary_source_type IN ('zoho', 'ebay', 'amazon', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_inbound_purchase_merge_log_org_winner
  ON inbound_purchase_merge_log (organization_id, winner_line_id);

COMMENT ON TABLE inbound_purchase_merge_log IS
  'Append-only audit of eBay↔Zoho spine-row merges (winner/loser line, primary/secondary source identities, reason). Universal Incoming Phase 1.';

-- ── FORCE-from-birth: loud-fail org default + FORCE RLS + canonical policy ───
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tenant_isolation') THEN
    FOREACH t IN ARRAY ARRAY[
      'inbound_purchase_order_links',
      'inbound_purchase_order_mirror',
      'inbound_purchase_order_equivalence',
      'inbound_purchase_merge_log'
    ] LOOP
      PERFORM enforce_tenant_isolation(t);
    END LOOP;
  ELSE
    RAISE NOTICE 'enforce_tenant_isolation absent — inbound_purchase_* tables left without FORCE RLS';
  END IF;
END $$;

COMMIT;
