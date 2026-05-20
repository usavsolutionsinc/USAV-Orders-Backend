-- ============================================================================
-- 2026-05-23_org_id_on_business_tables.sql
--
-- THE actual cross-tenant fix. The previous migration created the
-- organizations table and attached staff/sessions to it. This one attaches
-- every business table (orders, sku, receiving, fba_*, …) to the same
-- tenant boundary so a second customer cannot see USAV's rows.
--
-- Two complementary defenses:
--   1. Application layer: `organization_id` column on every table, every
--      query expected to filter on it (helped by `withTenantConnection`
--      which sets the GUC).
--   2. Database layer: ROW LEVEL SECURITY policy on every business table
--      that matches `organization_id = current_setting('app.current_org')`.
--      RLS is enabled but NOT FORCEd — the migration role is a superuser
--      and would bypass it anyway. Once the app uses a non-superuser
--      runtime role, FORCE can be turned on (one ALTER TABLE per table).
--
-- All existing USAV rows are backfilled to org #1 via a column DEFAULT
-- that is then dropped after the migration completes. Roll-forward only;
-- there is no automated rollback (rollback = drop column).
--
-- This migration is idempotent — every step uses IF NOT EXISTS / IF EXISTS
-- so re-running is a no-op.
-- ============================================================================

DO $$
DECLARE
  -- Every table that holds rows belonging to a single tenant. Add new
  -- business tables here in the same PR that creates them; the regression
  -- this prevents is "we added a table and forgot to scope it."
  business_table text;
  business_tables text[] := ARRAY[
    -- Channels + integrations
    'ebay_accounts',
    -- Inventory roots
    'favorite_skus','favorite_sku_workspaces','repair_issue_templates',
    -- Receiving / POs
    'receiving','receiving_lines','receiving_tasks','local_pickup_items',
    -- Customers + items + Zoho mirror
    'customers','items','zoho_locations','item_location_stock',
    'item_stock_cache','item_adjustments','entity_notes','sync_cursors',
    -- Replenishment
    'replenishment_requests','replenishment_order_lines','replenishment_status_log',
    -- Orders + sales + packages + invoices
    'sales_orders','packages','shipment_orders','invoices','credit_notes',
    'orders','order_shipment_links',
    -- Station activity
    'packer_logs','station_activity_logs','photos','work_assignments',
    -- SKU + stock
    'sku_stock','sku','sku_catalog','sku_platform_ids','sku_kit_parts',
    'sku_stock_ledger','stock_alerts',
    -- Locations / bins / serials
    'locations','bin_contents','location_transfers','serial_units',
    'serial_unit_condition_history','order_unit_allocations',
    'unit_id_sequences',
    -- Inventory event ledger
    'inventory_events','reason_codes',
    -- Cycle counts
    'cycle_count_campaigns','cycle_count_lines',
    -- Tech / QC / repair
    'tech_serial_numbers','tech_verifications','qc_check_templates',
    'repair_service','documents',
    -- FBA
    'fba_fnskus','fba_shipments','fba_shipment_items','fba_shipment_tracking',
    'fba_tracking_item_allocations','fba_fnsku_logs','fba_shipment_item_units',
    -- Exceptions / printers / AI
    'orders_exceptions','printer_profiles',
    'ai_chat_sessions','ai_chat_messages',
    'training_samples','training_runs','model_versions',
    -- Pipeline state
    'pipeline_tasks','pipeline_cycles'
  ];
  table_exists boolean;
  col_exists boolean;
BEGIN
  FOREACH business_table IN ARRAY business_tables LOOP
    -- Skip silently if a table from the list doesn't exist in this DB
    -- (lets the migration apply cleanly against partial schemas, e.g.
    -- a Neon branch that's mid-rebuild).
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = ''public'' AND table_name = %L)',
      business_table
    ) INTO table_exists;
    IF NOT table_exists THEN
      RAISE NOTICE 'skipping % — table does not exist', business_table;
      CONTINUE;
    END IF;

    -- 1. Add column if missing, with a DEFAULT so the backfill on every
    --    existing row is implicit. The default is dropped at step 3.
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ''public'' AND table_name = %L AND column_name = ''organization_id'')',
      business_table
    ) INTO col_exists;
    IF NOT col_exists THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN organization_id uuid NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001''',
        business_table
      );
      RAISE NOTICE 'added organization_id to %', business_table;
    END IF;

    -- 2. Backfill anything still null (in case the default didn't apply
    --    for some reason — e.g. the column was added by hand earlier).
    EXECUTE format(
      'UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL',
      business_table
    );

    -- 3. Replace the backfill default with one that reads from the tenant
    --    GUC set by withTenantConnection. Effect:
    --      - Code using withTenantConnection → GUC is set → insert auto-
    --        stamps the row with the caller's org. Application code doesn't
    --        have to specify organization_id on every .values() call.
    --      - Code that bypasses withTenantConnection → GUC is empty →
    --        NULLIF returns NULL → NOT NULL violation → loud failure.
    --        That's the desired safety: forgetting to scope a query
    --        cannot silently land rows under USAV's org.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT NULLIF(current_setting(''app.current_org'', true), '''')::uuid',
      business_table
    );

    -- 4. FK to organizations(id). RESTRICT on delete so we don't silently
    --    nuke business data when a tenant is hard-deleted (the proper
    --    flow is the GDPR /api/admin/org/delete soft-delete + purge job).
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      business_table, business_table || '_organization_fk'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT',
      business_table, business_table || '_organization_fk'
    );

    -- 5. Index. Lookups by org are the hottest path now that everything
    --    is tenant-scoped.
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (organization_id)',
      'idx_' || business_table || '_organization',
      business_table
    );

    -- 6. Enable RLS + policy. Not FORCEd because the migration role is
    --    superuser; flip to FORCE once we move the app to a non-superuser
    --    role (next ops PR). Until then this is "armed but not enforced"
    --    and the application-layer scoping is the only line of defense.
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', business_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',
                   business_table || '_tenant_isolation', business_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      business_table || '_tenant_isolation', business_table
    );
  END LOOP;
END $$;

-- ─── audit_logs: keep actor-scoped, but stamp org for tenant-scoped views ───
-- audit_logs already attributes the actor; adding organization_id makes the
-- viewer query trivially indexable rather than requiring a JOIN against
-- staff every time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'organization_id') THEN
      ALTER TABLE audit_logs ADD COLUMN organization_id uuid;
      UPDATE audit_logs a
         SET organization_id = s.organization_id
        FROM staff s
       WHERE s.id = a.actor_staff_id
         AND a.organization_id IS NULL;
      -- Some audit rows have no actor (system events); leave them NULL
      -- and create the index without enforcing NOT NULL.
      CREATE INDEX IF NOT EXISTS idx_audit_logs_organization ON audit_logs (organization_id);
    END IF;
  END IF;
END $$;
