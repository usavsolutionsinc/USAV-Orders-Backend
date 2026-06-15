-- ============================================================================
-- 2026-06-14_org_id_needs_col_usav_default.sql   (E1 safety prep)
--
-- The Phase-B NEEDS-COL columns (needs_col + needs_col_2) are NULLABLE with a
-- GUC-only default: NULLIF(current_setting('app.current_org', true), '')::uuid.
-- Under the OWNER pool (raw `pool`, session-less writers: Zoho/carrier/sheets
-- sync, webhooks) the GUC is unset, so that default yields NULL.
--
-- THE RISK this fixes: once the runtime's GUC paths connect as the non-BYPASSRLS
-- `app_tenant` role (E1), armed RLS filters reads by organization_id = GUC. A
-- row with organization_id IS NULL matches no policy → it becomes INVISIBLE to
-- the app. Ongoing owner-pool session-less inserts would therefore silently hide
-- newly-synced data (PO mirror, tracking, manuals, …).
--
-- THE FIX (single-tenant interim): default to the GUC when set, else the USAV
-- org — so an owner-pool insert lands USAV (visible under app_tenant+GUC=USAV)
-- and a GUC-wrapped insert still lands the correct org. There are 0 NULL-org
-- rows today (all backfilled), so this is purely forward-looking.
--
-- 2ND-TENANT FOLLOW-UP: before onboarding tenant #2, thread org through the
-- session-less writers for these tables and restore the GUC-only default
-- (COALESCE → USAV would mis-stamp tenant B's owner-pool inserts). Tracked in
-- docs/tier0-execution-checklist.md.
--
-- Idempotent / roll-forward only.
-- ============================================================================

DO $$
DECLARE
  t text;
  usav_default constant text :=
    'COALESCE(NULLIF(current_setting(''app.current_org'', true), '''')::uuid, ''00000000-0000-0000-0000-000000000001''::uuid)';
  needs_default_tables text[] := ARRAY[
    'bose_models','bose_serial_prefixes','failure_modes','messages','mobile_scan_events',
    'operations_kpi_rollup_state','operations_kpi_rollups_daily','operations_kpi_rollups_hourly',
    'part_acquisitions','part_compatibility','picking_sessions','product_manuals',
    'replenishment_tasks','return_dispositions','rma_authorizations','shipment_tracking_events',
    'shipping_tracking_numbers','sku_management','sku_pairing_suggestions','sourcing_alerts',
    'sourcing_candidates','sourcing_searches','square_transactions','staff_goal_history',
    'staff_goals','staff_stations','staff_todo_completions','staff_todos','suppliers',
    'tracking_exceptions','unit_failure_tags','unit_quality_scores','warehouses',
    'zoho_item_images','zoho_po_mirror'
  ];
  has_col boolean;
BEGIN
  FOREACH t IN ARRAY needs_default_tables LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=''public'' AND table_name=%L AND column_name=''organization_id'')',
      t
    ) INTO has_col;
    IF NOT has_col THEN
      RAISE NOTICE 'skip % — no organization_id column', t;
      CONTINUE;
    END IF;
    -- Defensive re-backfill (there are 0 NULLs today, but make it safe to re-run).
    EXECUTE format('UPDATE %I SET organization_id = ''00000000-0000-0000-0000-000000000001'' WHERE organization_id IS NULL', t);
    -- Default to GUC when present, else USAV (single-tenant interim).
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT %s', t, usav_default);
  END LOOP;
END $$;
