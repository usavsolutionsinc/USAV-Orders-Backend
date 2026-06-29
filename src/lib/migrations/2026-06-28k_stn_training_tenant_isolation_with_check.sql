-- ============================================================================
-- 2026-06-28k_stn_training_tenant_isolation_with_check.sql
--
-- Complete the tenant_isolation policy on three tables that were FORCEd by the
-- concurrent STN/training_runs waves with a USING clause but NO WITH CHECK.
-- Postgres defaults WITH CHECK to the USING expression, so writes were already
-- constrained — but the cross-org canary (and good hygiene) require an EXPLICIT
-- WITH CHECK so INSERT/UPDATE isolation is unambiguous and self-documenting.
--
-- Expression is the canonical loud-fail form, identical to the existing USING,
-- so read AND write semantics are unchanged (each org sees/writes only its own
-- rows under app_tenant; the owner pool bypasses for the global STN/hermes paths).
-- Idempotent: DROP POLICY IF EXISTS + CREATE.
--
--   shipment_tracking_events   (STN spine)
--   shipping_tracking_numbers  (STN spine)
--   training_runs              (system; its separate `hermes_agent_read` USING-true
--                               policy for the cross-org AI read path is left intact)
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shipment_tracking_events',
    'shipping_tracking_numbers',
    'training_runs'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'stn_training_with_check: skip % (does not exist)', t; CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I '
      || 'USING (organization_id = (NULLIF(current_setting(''app.current_org'', true), ''''))::uuid) '
      || 'WITH CHECK (organization_id = (NULLIF(current_setting(''app.current_org'', true), ''''))::uuid)',
      t);
    RAISE NOTICE 'stn_training_with_check: tenant_isolation USING+WITH CHECK set on %', t;
  END LOOP;
END $$;
