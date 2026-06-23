-- ============================================================================
-- 2026-06-22f_enforce_tenant_isolation_loudfail_verified.sql
--
-- FORCE RLS on the per-tenant tables that have a loud-fail or no column default
-- (so an owner-pool INSERT without org would NOT-NULL-fail) — but whose EVERY
-- INSERT site was verified (2026-06-22) to stamp organization_id explicitly:
--   handling_units      → handling-unit-queries.ts:346
--   repair_actions      → api/repair/actions/route.ts:107
--   serial_unit_listings→ markUnitListed.ts:98
--   testing_results     → recordTestVerdict.ts:241
--   unit_repairs        → repairs-queries.ts:142
--   platforms / types   → catalog-queries.ts (all INSERTs carry organization_id)
-- So FORCE is non-breaking (writers stamp org; reads bypass on owner / scope on
-- tenant; no direct tenantPool usage). Revert per table: relax_tenant_isolation(<t>).
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'handling_units', 'repair_actions', 'serial_unit_listings', 'testing_results',
    'unit_repairs', 'platforms', 'types'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'loudfail_verified: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'loudfail_verified: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'loudfail_verified: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
