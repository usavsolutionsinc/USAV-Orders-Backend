-- ============================================================================
-- 2026-06-28c_enforce_tenant_isolation_backstop_wave7.sql
--
-- Backstop wave 7: the last two convertible tables, now FORCE-safe (2026-06-28):
--   warranty_claims                — mutations.ts:208 INSERT explicit org (default already loud-fail);
--                                    claims.ts reads via tenantQuery; clock-sweep UPDATEs by id (owner pool,
--                                    FORCE inert); the 2 flagged routes delegate to GUC helpers (false positives).
--   email_missing_purchase_orders  — reconcile-run.ts:224 INSERT explicit org; the one REAL unscoped reader
--                                    (admin/po-gmail/triage/[id]/detail) was converted to tenantQuery + explicit
--                                    org this session, so no owner-pool reader bypasses FORCE.
--
-- Idempotent + guarded. Revert: SELECT relax_tenant_isolation('<t>').
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['warranty_claims','email_missing_purchase_orders'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave7: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave7: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave7: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
