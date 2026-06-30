-- ============================================================================
-- 2026-06-29c_receiving_line_facts_tables.sql
--
-- Receiving polymorphic refactor — Layer 2 (typed facts).
-- Plan: docs/todo/polymorphic-tables-database-refactor-plan.md §4 (Layer 2).
--
-- The receiving spine (receiving / receiving_lines) crammed ~30 one-street
-- columns into two wide tables (receiving_lines is 51 cols). This migration
-- creates the ADDITIVE typed-facts side-tables that those columns will move into
-- during the per-street cutover, so a street joins only the facts it cares about
-- and the spine slims to universal columns. Mirrors the existing extraction of
-- receiving_exceptions (2026-06-24).
--
--   receiving_line_zoho     — Zoho-PO-origin line facts (the ~12-col Zoho cluster
--                             + unit_price). 1:1 with the line.
--   receiving_line_testing  — line-level testing/QA routing facts (needs_test,
--                             assigned_tech_id, qa/disposition/condition,
--                             disposition_final, disposition_audit). 1:1.
--   receiving_line_return   — RETURN/TRADE_IN intake facts (return_platform,
--                             return_reason, source_order_id, rma_ref). 1:1.
--   receiving_line_putaway  — putaway facts (location_code, bin, put_away_*). 1:1.
--   receiving_line_facts    — the long-tail / org-custom typed-facts registry:
--                             (line_id, fact_kind, payload jsonb). fact_kind is a
--                             code-registry discriminator (validated in
--                             src/lib/receiving/facts/registry.ts at write time —
--                             same pattern as workflow_nodes.type). 1:N by kind.
--
-- The four 1:1 tables use receiving_line_id AS the primary key (class-table
-- subtype shape): one facts row per line, cascade-deleted with the line.
--
-- TENANT-FROM-BIRTH: organization_id NOT NULL with the GUC loud-fail-able default;
-- every key leads with organization_id (closing the cross-tenant gap in the
-- legacy global ux_receiving_lines_zoho_* keys — the new zoho uniques are org-led).
--
-- ⚠ RLS ARMED, NOT FORCED — the writers (facts.ts + the per-street lanes) are not
-- wired yet, so per the db-migration-author safety gate we ENABLE + policy but do
-- NOT FORCE here; mirrors receiving_exceptions (2026-06-24). These tables join the
-- FORCE set in a later enforce migration once every writer stamps org via
-- withTenantTransaction. RLS is inert under neondb_owner (BYPASSRLS) regardless.
--
-- ADDITIVE + IDEMPOTENT: pure CREATE … IF NOT EXISTS; nothing reads or writes
-- these until the facts helpers + street lanes land. No change to receiving /
-- receiving_lines here (column drops happen after the per-street reader cutover).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS receiving_line_facts, receiving_line_putaway,
--     receiving_line_return, receiving_line_testing, receiving_line_zoho;
-- VERIFY: \d receiving_line_zoho ; INSERT under a tenant GUC stamps org.
-- ============================================================================

BEGIN;

-- ── receiving_line_zoho ─────────────────────────────────────────────────────
-- Zoho-PO-origin facts. Only Zoho-matched lines get a row; unmatched/manual
-- lines never do (the spine no longer needs the Zoho cluster on every row).
CREATE TABLE IF NOT EXISTS receiving_line_zoho (
  receiving_line_id        integer PRIMARY KEY REFERENCES receiving_lines(id) ON DELETE CASCADE,
  organization_id          uuid NOT NULL
                             DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  zoho_item_id             text,
  zoho_line_item_id        text,
  zoho_purchase_receive_id text,
  zoho_purchaseorder_id    text,
  zoho_purchaseorder_number text,
  zoho_reference_number    text,
  zoho_sync_source         text,
  zoho_last_modified_time  text,
  zoho_synced_at           timestamptz,
  zoho_notes               text,                  -- read-only Zoho PO line description
  unit_price               numeric(12,2),         -- read-only mirror of Zoho line.rate; Zoho is SoR
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Org-led replacements for the legacy GLOBAL ux_receiving_lines_zoho_* keys.
-- NULLs are distinct in a UNIQUE index, so these only bind real Zoho ids.
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_line_zoho_org_po_line
  ON receiving_line_zoho (organization_id, zoho_purchaseorder_id, zoho_line_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_line_zoho_org_pr_line
  ON receiving_line_zoho (organization_id, zoho_purchase_receive_id, zoho_line_item_id);
CREATE INDEX IF NOT EXISTS idx_receiving_line_zoho_org_po
  ON receiving_line_zoho (organization_id, zoho_purchaseorder_id)
  WHERE zoho_purchaseorder_id IS NOT NULL;

COMMENT ON TABLE receiving_line_zoho IS
  'Zoho-PO-origin line facts (the Zoho cluster + unit_price), extracted from receiving_lines. 1:1 with the line; org-led keys. Receiving polymorphic refactor Layer 2.';

-- ── receiving_line_testing ──────────────────────────────────────────────────
-- Line-level testing/QA routing facts. Per-unit verdicts stay on serial_units /
-- testing_results — this is the routing/disposition grain only.
CREATE TABLE IF NOT EXISTS receiving_line_testing (
  receiving_line_id  integer PRIMARY KEY REFERENCES receiving_lines(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  needs_test         boolean NOT NULL DEFAULT true,
  assigned_tech_id   integer REFERENCES staff(id) ON DELETE SET NULL,
  qa_status          qa_status_enum NOT NULL DEFAULT 'PENDING',
  disposition_code   disposition_enum NOT NULL DEFAULT 'HOLD',
  condition_grade    condition_grade_enum NOT NULL DEFAULT 'BRAND_NEW',
  disposition_final  text,                        -- PASS_TO_STOCK | PASS_TO_FBA | PASS_TO_ORDER_TEST | FAIL_DAMAGED | ...
  disposition_audit  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The tech queue read: this org's needs-test lines, and per-tech assignment.
CREATE INDEX IF NOT EXISTS idx_receiving_line_testing_org_needs_test
  ON receiving_line_testing (organization_id)
  WHERE needs_test;
CREATE INDEX IF NOT EXISTS idx_receiving_line_testing_org_tech
  ON receiving_line_testing (organization_id, assigned_tech_id)
  WHERE assigned_tech_id IS NOT NULL;

COMMENT ON TABLE receiving_line_testing IS
  'Line-level testing/QA routing facts (needs_test, assigned tech, qa/disposition/condition), extracted from receiving_lines. Per-unit verdicts stay on serial_units/testing_results. Receiving polymorphic refactor Layer 2.';

-- ── receiving_line_return ───────────────────────────────────────────────────
-- RETURN / TRADE_IN intake facts (the kind-specific columns).
CREATE TABLE IF NOT EXISTS receiving_line_return (
  receiving_line_id  integer PRIMARY KEY REFERENCES receiving_lines(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  return_platform    return_platform_enum,
  return_reason      text,
  source_order_id    text,                        -- the originating sales order id, if known
  rma_ref            text,                        -- RMA / authorization reference
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receiving_line_return_org_source_order
  ON receiving_line_return (organization_id, source_order_id)
  WHERE source_order_id IS NOT NULL;

COMMENT ON TABLE receiving_line_return IS
  'RETURN/TRADE_IN intake facts (return_platform, return_reason, source_order_id, rma_ref), extracted from receiving_lines. Receiving polymorphic refactor Layer 2.';

-- ── receiving_line_putaway ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receiving_line_putaway (
  receiving_line_id  integer PRIMARY KEY REFERENCES receiving_lines(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  location_code      text,                        -- warehouse bin code
  bin                text,
  put_away_at        timestamptz,
  put_away_by        integer REFERENCES staff(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receiving_line_putaway_org_location
  ON receiving_line_putaway (organization_id, location_code)
  WHERE location_code IS NOT NULL;

COMMENT ON TABLE receiving_line_putaway IS
  'Putaway facts (location_code, bin, put_away_*), extracted from receiving_lines.location_code. Receiving polymorphic refactor Layer 2.';

-- ── receiving_line_facts (the long-tail / org-custom registry) ──────────────
-- (line_id, fact_kind) is the polymorphic anchor; payload is a tagged union
-- validated against the per-fact_kind Zod schema in
-- src/lib/receiving/facts/registry.ts at write time (same governance as
-- workflow_nodes.type → configSchema). fact_kind is deliberately free TEXT (not a
-- CHECK) so a new org/kind needs no migration — the code registry is the gate.
CREATE TABLE IF NOT EXISTS receiving_line_facts (
  id                 bigserial PRIMARY KEY,
  organization_id    uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_org', true), '')::uuid,
  receiving_line_id  integer NOT NULL REFERENCES receiving_lines(id) ON DELETE CASCADE,
  fact_kind          text NOT NULL,               -- 'marketplace_listing' | 'sourcing_import' | 'trade_in_valuation' | 'repair_service' | org-custom
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- one row per (line, fact_kind) within an org
  CONSTRAINT ux_receiving_line_facts_line_kind UNIQUE (organization_id, receiving_line_id, fact_kind)
);

CREATE INDEX IF NOT EXISTS idx_receiving_line_facts_org_kind
  ON receiving_line_facts (organization_id, fact_kind);
CREATE INDEX IF NOT EXISTS idx_receiving_line_facts_line
  ON receiving_line_facts (receiving_line_id);

COMMENT ON TABLE receiving_line_facts IS
  'Long-tail/org-custom receiving-line typed facts: (line_id, fact_kind, payload). fact_kind validated by src/lib/receiving/facts/registry.ts (code registry, not a DB CHECK) so new kinds need no migration. Receiving polymorphic refactor Layer 2.';

-- ── Arm RLS on all five (NOT forced; writers land in later street PRs) ───────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'receiving_line_zoho','receiving_line_testing','receiving_line_return',
    'receiving_line_putaway','receiving_line_facts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      $f$CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)$f$,
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

COMMIT;
