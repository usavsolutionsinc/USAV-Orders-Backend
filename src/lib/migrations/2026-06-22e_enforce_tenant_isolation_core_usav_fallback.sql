-- ============================================================================
-- 2026-06-22e_enforce_tenant_isolation_core_usav_fallback.sql
--
-- FORCE RLS on the remaining high-traffic core tenant tables. SAFETY BASIS
-- (verified 2026-06-22, dogfood single-org stage):
--   • Every one has organization_id NOT NULL + an armed tenant_isolation policy.
--   • Every one uses the USAV-FALLBACK column default
--     (COALESCE(NULLIF(current_setting('app.current_org',true),'')::uuid, USAV)),
--     so an owner-pool INSERT with no GUC stamps USAV — FORCE does NOT break
--     inserts (unlike a loud-fail default).
--   • No production code queries `tenantPool` directly (grep-verified) — all
--     tenant-pool access goes through the GUC-setting wrappers (tenantQuery /
--     withTenantConnection / withTenantTransaction), so a tenant-pool consumer
--     always has app.current_org set; owner-pool consumers bypass RLS.
--   ⇒ Non-breaking in dogfood: reads bypass (owner) or scope to USAV (tenant),
--     inserts default to USAV. Isolation is complete for tenant-pool-routed
--     consumers; the route sweep continues to move the rest onto that path
--     before tenant #2 onboards. Revert per table: relax_tenant_isolation(<t>).
--
-- EXCLUDED here on purpose: loud-fail-default tables (handling_units,
-- repair_actions, serial_unit_listings, testing_results, unit_repairs — owner
-- inserts would NOT-NULL-fail unless every writer stamps org; verify first),
-- no-default tables (platforms, types), system/global self-improvement tables
-- (pipeline_*, training_*), external-writer (hermes_*), and the engine tables
-- (item_workflow_state/workflow_*/zoho_locations — Phase C5).
--
-- Per-table fault isolation: one failure is caught + logged, others proceed.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'documents', 'ebay_api_calls', 'fba_fnskus', 'inventory_events', 'invoices',
    'item_stock_cache', 'items', 'locations', 'order_shipment_links', 'order_unit_allocations',
    'orders', 'orders_exceptions', 'packages', 'photos', 'repair_service',
    'replenishment_order_lines', 'replenishment_requests', 'replenishment_status_log', 'sku',
    'sku_catalog', 'sku_stock', 'sku_stock_ledger', 'station_activity_logs', 'unit_id_sequences',
    'work_assignments'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'core_usav: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'core_usav: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'core_usav: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
