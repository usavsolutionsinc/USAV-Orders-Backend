-- ============================================================================
-- 2026-06-22_enforce_tenant_isolation_ready_cohort.sql
--
-- Tenant-isolation ENFORCEMENT (FORCE RLS) for the cohort that became
-- slice-ready after the 2026-06-22 Phase-C route sweep. Each table below:
--   • is tenant-owned with organization_id NOT NULL + an armed tenant_isolation
--     policy (Phase B), and
--   • has its ENTIRE non-cron route fan-in GUC-wrapped (route-audit reverse
--     index all-low), verified against route-audit.generated.json after the
--     receiving/serial/tech/packer + fulfillment route waves landed.
--
-- FORCE is dual-pool-safe in this deployment: the default @/lib/db pool
-- (neondb_owner, BYPASSRLS) bypasses it for any not-yet-migrated raw-pool/lib
-- access, while the runtime tenant pool (app_tenant) sets app.current_org via the
-- GUC wrappers — so flipping these never breaks the app; it only adds isolation
-- for the tenant-pool consumers. Each is independently revertable:
--   SELECT relax_tenant_isolation('<table>');
--
-- DELIBERATELY EXCLUDED (do NOT add here without their own prep):
--   • nullable-org tables (tracking_exceptions, unit_failure_tags/quality_scores,
--     sku_management, sourcing_*, staff_*, google_photos_*, operations_kpi_*,
--     replenishment_tasks, zoho_item_images) — a strict =GUC policy would hide
--     existing NULL-org rows; need Phase-B SET NOT NULL first.
--   • hermes_* — written by the EXTERNAL Hermes service which doesn't set the GUC
--     yet (would loud-fail its inserts). Defer to the Hermes-writer org-thread.
--   • pipeline_* / training_* — system/global self-improvement tables (kept global
--     per the tenancy plan; use transitionalUsavOrgId).
--   • zoho_locations — neon-http-only consumer (Phase C5); FORCE would lock the
--     stateless reader out once the role flips. Force it WITH the C5 migration.
--
-- Per-table fault isolation: a failure on one table (e.g. a missing policy) is
-- caught + logged and leaves that table unforced, instead of aborting the batch.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_chat_messages', 'ai_chat_sessions', 'api_idempotency_responses', 'ebay_accounts',
    'fba_fnsku_logs', 'fba_shipment_item_units', 'fba_shipment_items', 'fba_shipment_tracking',
    'fba_shipments', 'fba_tracking_item_allocations', 'item_adjustments', 'item_location_stock',
    'local_pickup_items', 'local_pickup_order_items', 'local_pickup_orders', 'platform_accounts',
    'platform_listings', 'repair_failure_resolutions', 'sales_orders', 'shipment_orders',
    'sku_kit_parts', 'sync_cursors', 'tech_verifications'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'ready_cohort: skip % (does not exist)', t;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'ready_cohort: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ready_cohort: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
