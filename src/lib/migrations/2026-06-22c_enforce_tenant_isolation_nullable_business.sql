-- ============================================================================
-- 2026-06-22c_enforce_tenant_isolation_nullable_business.sql
--
-- Tighten + FORCE the per-tenant business tables that Phase B left with a
-- NULLABLE organization_id but which (verified 2026-06-22) carry ZERO NULL-org
-- rows and have their entire non-cron route fan-in GUC-wrapped/helper-scoped.
-- For each: SET NOT NULL (safe — 0 nulls), then enforce_tenant_isolation (FORCE).
--
-- All are per-tenant (receiving exceptions, unit QC, sourcing, sku mgmt, staff
-- goals/todos, zoho image mirror) — none is a system/global table with legit
-- NULL rows (audit_logs / order_ingest_queue / stripe_events are deliberately
-- NOT here). Cron consumers fan out per-org (forEachActiveOrg, GUC-set) or run
-- on the owner pool (bypass) — FORCE is dual-pool-safe either way.
--
-- Per-table fault isolation: a failure (e.g. a row inserted NULL-org between the
-- check and apply) is caught + logged, leaving that table untouched.
-- Revert per table: relax_tenant_isolation(<t>) (FORCE off; NOT NULL stays).
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tracking_exceptions', 'unit_failure_tags', 'unit_quality_scores', 'sku_management',
    'replenishment_tasks', 'sourcing_alerts', 'sourcing_candidates', 'sourcing_searches',
    'staff_goal_history', 'staff_todos', 'zoho_item_images', 'sku_pairing_suggestions'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'nullable_business: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'nullable_business: NOT NULL + FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'nullable_business: %(%) — left as-is', SQLERRM, t;
    END;
  END LOOP;
END $$;
