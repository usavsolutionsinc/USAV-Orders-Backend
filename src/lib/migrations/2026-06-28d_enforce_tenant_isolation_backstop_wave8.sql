-- ============================================================================
-- 2026-06-28d_enforce_tenant_isolation_backstop_wave8.sql
--
-- Backstop wave 8: the 4 hermes tables. They already have RLS ENABLED + a
-- tenant_isolation policy; their only writer is the EXTERNAL hermes_agent role,
-- which is already RLS-subject (not the table owner). FORCE adds owner-side
-- enforcement; no in-repo / owner-pool writer exists to break. Guarded per table
-- (e.g. if a nullable-org legacy row blocks a constraint, that table is skipped,
-- logged, and left unforced — no harm).
-- Revert: SELECT relax_tenant_isolation('<t>').
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hermes_insights','hermes_outcomes','hermes_precision_scores','hermes_thresholds'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave8: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave8: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave8: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
