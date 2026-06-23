-- ============================================================================
-- 2026-06-22b_enforce_tenant_isolation_core_lowfanin.sql
--
-- FORCE RLS for two core tables whose entire route fan-in was confirmed
-- org-safe by the 2026-06-22 low-fan-in core wrap+verify wave:
--   • customers  — consumers repair-service/[id] (wrapped), repair/customers,
--                  walk-in/customers, walk-in/status (all helper-scoped via
--                  org-required repair/walk-in query helpers).
--   • bin_contents — consumer replenishment/tasks/[id]/complete (org-safe) +
--                  the stock-alerts / drift-check crons (forEachActiveOrg, GUC-set).
--
-- The route-audit still shows these as tenantWrapped=false because its static
-- scan can't see helper-level GUC delegation; the consumer set was verified
-- org-safe directly. Both have organization_id NOT NULL + an armed policy.
-- FORCE is dual-pool-safe; revert per table via relax_tenant_isolation(<t>).
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'bin_contents'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'core_lowfanin: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'core_lowfanin: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'core_lowfanin: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
