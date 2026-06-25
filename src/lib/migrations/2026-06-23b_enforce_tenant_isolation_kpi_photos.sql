-- ============================================================================
-- 2026-06-23b_enforce_tenant_isolation_kpi_photos.sql
--
-- FORCE the last genuinely per-tenant tables:
--   operations_kpi_rollup_state / _rollups_daily / _rollups_hourly  (per-org
--     operational analytics; usav-fallback default, 0 NULL-org rows, rebuilt
--     per-org by the KPI cron)
--   google_photos_albums / google_photos_settings  (per-org photo-backup config;
--     0 NULL-org rows; no active runtime writer in this repo — the backup feature
--     is dormant, so loud-fail FORCE is non-breaking)
-- SET NOT NULL first (verified 0 nulls), then enforce_tenant_isolation.
--
-- The other still-unforced tables are platform/system/global BY DESIGN, NOT
-- per-tenant, so they are deliberately left unforced:
--   shipping_tracking_numbers / shipment_tracking_events  (a tracking number is
--     shared/global, not owned by one org — see the receiving-tenant-hardening rule)
--   pipeline_* / training_*  (platform-wide self-improvement; must aggregate
--     across orgs, scoping them per-org would be wrong)
--   hermes_*  (platform AI insights written by the EXTERNAL Hermes service which
--     doesn't thread org; force only after that writer is org-aware)
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operations_kpi_rollup_state', 'operations_kpi_rollups_daily', 'operations_kpi_rollups_hourly',
    'google_photos_albums', 'google_photos_settings'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'kpi_photos: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'kpi_photos: NOT NULL + FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'kpi_photos: %(%) — left as-is', SQLERRM, t;
    END;
  END LOOP;
END $$;
