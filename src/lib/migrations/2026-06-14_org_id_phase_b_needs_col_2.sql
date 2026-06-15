-- ============================================================================
-- 2026-06-14_org_id_phase_b_needs_col_2.sql   (Phase B — schema coverage, batch 2)
--
-- Adds organization_id to the tables the 2026-06-14 hot-core sweep + Wave-2
-- shared-module migration proved are still NOT isolatable by GUC-wrapping alone,
-- because they have NO own organization_id column (coverage = "tenant-owned-
-- NEEDS-COL" or "child-scoped"). The route + shared-module layers now THREAD
-- org and scope via the parent where one exists, but for these tables to ever
-- FORCE (Phase E) — and for the no-clean-parent ones to be isolated at all —
-- they need their own column + RLS policy.
--
-- Grouped by why they need it:
--   tenant-owned, no column, no parent:  shipment_tracking_events,
--     shipping_tracking_numbers, sku_management, zoho_item_images,
--     zoho_po_mirror, messages, operations_kpi_rollup_state
--   child-scoped (app scopes via parent today; column needed for FORCE):
--     product_manuals, part_compatibility, staff_stations, staff_goals,
--     staff_goal_history, staff_todos, staff_todo_completions,
--     operations_kpi_rollups_daily, operations_kpi_rollups_hourly,
--     picking_sessions, mobile_scan_events, return_dispositions,
--     unit_failure_tags, unit_quality_scores, bose_models,
--     bose_serial_prefixes, failure_modes, replenishment_tasks,
--     sku_pairing_suggestions, part_acquisitions, tracking_exceptions
--
-- NOT included (deliberate — need a product decision, not a blind column):
--   hermes_* (AI infra — likely cross-org shared, not per-tenant),
--   google_photos_albums/settings (integration config — may be global),
--   api_idempotency_responses (its unique key is (idempotency_key, route);
--     org-scoping changes the key semantics — handle separately).
--
-- ⚠ NULLABLE ON PURPOSE (matches 2026-06-14_org_id_phase_b_needs_col.sql): some
--   of these still have un-threaded session-less writers (ebay-sync, ingestOrder,
--   google-sheets sync, square webhook, replenishment/sourcing crons). A NOT NULL
--   + GUC-default column would loud-fail those inserts. So: add the column
--   NULLABLE with a USAV backfill + GUC default. FOLLOW-UP before FORCE per table:
--   (1) thread org through the session-less writers, (2) SET NOT NULL,
--   (3) add explicit organization_id predicates/stamps in the now-org-aware
--   shared modules (most already accept an optional orgId — just need the column
--   to exist to filter on), (4) for the string-uniqueness tables
--   (shipping_tracking_numbers, zoho_po_mirror) decide whether the natural key
--   should become composite per org.
--
-- ⚠ INERT UNTIL E1 (app_tenant loses BYPASSRLS): ENABLE RLS + the armed policy
--   grant ZERO isolation under neondb_owner. Scaffolding only; real isolation
--   begins when app_tenant is live AND enforce_tenant_isolation() FORCEs each
--   table (gated on its routes being GUC-safe). Do NOT call it here.
--
-- Idempotent (IF [NOT] EXISTS throughout) and roll-forward only. The DO-block
-- skips any table that doesn't exist in this DB.
-- ============================================================================

DO $$
DECLARE
  t text;
  needs_col_tables text[] := ARRAY[
    -- tenant-owned, no parent
    'shipment_tracking_events',
    'shipping_tracking_numbers',
    'sku_management',
    'zoho_item_images',
    'zoho_po_mirror',
    'messages',
    'operations_kpi_rollup_state',
    -- child-scoped (column needed for FORCE)
    'product_manuals',
    'part_compatibility',
    'staff_stations',
    'staff_goals',
    'staff_goal_history',
    'staff_todos',
    'staff_todo_completions',
    'operations_kpi_rollups_daily',
    'operations_kpi_rollups_hourly',
    'picking_sessions',
    'mobile_scan_events',
    'return_dispositions',
    'unit_failure_tags',
    'unit_quality_scores',
    'bose_models',
    'bose_serial_prefixes',
    'failure_modes',
    'replenishment_tasks',
    'sku_pairing_suggestions',
    'part_acquisitions',
    'tracking_exceptions'
  ];
  table_exists boolean;
  col_exists boolean;
BEGIN
  FOREACH t IN ARRAY needs_col_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ''public'' AND table_name = %L)',
      t
    ) INTO table_exists;
    IF NOT table_exists THEN
      RAISE NOTICE 'skipping % — table does not exist', t;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ''public'' AND table_name = %L AND column_name = ''organization_id'')',
      t
    ) INTO col_exists;
    IF NOT col_exists THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id uuid', t);
      RAISE NOTICE 'added organization_id to %', t;
    END IF;

    -- Backfill existing rows to USAV (the only tenant today).
    EXECUTE format(
      'UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL',
      t
    );

    -- Default new rows from the tenant GUC (NULL when unset — no loud-fail, so
    -- the un-threaded session-less writers keep working until threaded).
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid',
      t
    );

    -- FK to organizations(id) (NULLs allowed until SET NOT NULL).
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_organization_fk');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT',
      t, t || '_organization_fk'
    );

    -- Index by org.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
      'idx_' || t || '_organization', t
    );

    -- ENABLE RLS + canonical (non-FORCE) policy. ARMED, NOT ENFORCED.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
