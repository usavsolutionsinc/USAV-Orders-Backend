-- ============================================================================
-- 2026-06-14_org_id_phase_b_domain_children.sql   (Phase B — schema coverage)
--
-- Adds organization_id to the child-scoped business tables that the
-- 2026-05-23 business-table migration MISSED (they had no own org column;
-- coverage.generated.json classifies them "child-scoped" / "NEEDS-COL").
-- These are the receiving / serial-unit / repair / handling-unit / local-
-- pickup children. Until they carry organization_id, their routes cannot be
-- org-filtered and their tables cannot be FORCE-enforced (Phase E).
--
-- ⚠ INERT UNTIL THE APP ROLE LOSES BYPASSRLS (Phase E1):
--   ENABLE ROW LEVEL SECURITY + the policy below grant ZERO isolation on their
--   own. The app currently connects as neondb_owner (rolbypassrls = true), which
--   bypasses RLS entirely. This migration is correctness SCAFFOLDING (column +
--   GUC default + FK + index + armed policy); real isolation only begins once
--   the non-BYPASSRLS app_tenant role is live AND enforce_tenant_isolation()
--   FORCEs each table (gated per table on its routes being GUC-safe). Do NOT
--   call enforce_tenant_isolation() here.
--
-- Backfill: USAV is the only tenant today, so every existing child row already
-- belongs to USAV — the USAV column DEFAULT backfills correctly (equivalent to
-- backfilling from each row's org-bearing parent). New rows resolve org from the
-- app.current_org GUC default; a write with no GUC loud-fails (NOT NULL), which
-- is the intended footgun guard.
--
-- Idempotent (IF [NOT] EXISTS throughout) and roll-forward only.
-- ============================================================================

DO $$
DECLARE
  child_table text;
  -- Child-scoped tables tightly coupled to already-migrated/hot tables
  -- (receiving, serial_units, receiving_lines, repair_service). Add new
  -- child tables here in the same PR that creates them.
  child_tables text[] := ARRAY[
    -- Handling units (testing totes; child of locations/staff)
    'handling_units',
    -- Receiving children
    'receiving_scans','receiving_shipments',
    -- Tech / QC / repair children
    'testing_results','repair_actions','unit_repairs','repair_failure_resolutions',
    -- Local pickup
    'local_pickup_orders','local_pickup_order_items'
  ];
  table_exists boolean;
  col_exists boolean;
BEGIN
  FOREACH child_table IN ARRAY child_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ''public'' AND table_name = %L)',
      child_table
    ) INTO table_exists;
    IF NOT table_exists THEN
      RAISE NOTICE 'skipping % — table does not exist', child_table;
      CONTINUE;
    END IF;

    -- 1. Add column (USAV default backfills every existing row).
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ''public'' AND table_name = %L AND column_name = ''organization_id'')',
      child_table
    ) INTO col_exists;
    IF NOT col_exists THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN organization_id uuid NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001''',
        child_table
      );
      RAISE NOTICE 'added organization_id to %', child_table;
    END IF;

    -- 2. Backfill any stragglers (hand-added columns, etc.).
    EXECUTE format(
      'UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL',
      child_table
    );

    -- 3. Flip the default to the tenant GUC (loud-fail when unset).
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid',
      child_table
    );

    -- 4. FK to organizations(id), RESTRICT on delete (mirrors the parent migration).
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      child_table, child_table || '_organization_fk'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT',
      child_table, child_table || '_organization_fk'
    );

    -- 5. Index by org.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
      'idx_' || child_table || '_organization', child_table
    );

    -- 6. ENABLE RLS + canonical (non-FORCE) policy. ARMED, NOT ENFORCED —
    --    see the header warning. enforce_tenant_isolation() (FORCE) is Phase E.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', child_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
                   child_table || '_tenant_isolation', child_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      child_table || '_tenant_isolation', child_table
    );
  END LOOP;
END $$;
