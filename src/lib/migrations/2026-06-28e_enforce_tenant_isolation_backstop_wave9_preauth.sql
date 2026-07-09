-- ============================================================================
-- 2026-06-28e_enforce_tenant_isolation_backstop_wave9_preauth.sql
--
-- Backstop wave 9 — the pre-auth identity tables. Every WRITER stamps
-- organization_id explicitly (verified 2026-06-28), so FORCE+loud-fail breaks no
-- INSERT:
--   staff               — signup:108, sso/callback:162, admin/staff:68,
--                         admin/staff/invite:55, identity/invitations:253 (all explicit org)
--   staff_sessions      — session.ts:142 INSERT (organization_id from staff.organization_id)
--   email_login_tokens  — email-login/request:58 INSERT explicit org
--
-- Pre-auth READS (signin / staff-picker / session-validate) run on the OWNER pool
-- (FORCE-inert → never broken) and are gated by tenant-slug resolution + secret
-- sid/token + the passing IDOR regression tests. Post-auth reads go through the
-- tenant GUC → now RLS-enforced. USAV is single-tenant today, so FORCE is
-- behavior-identical for the live app (GUC=USAV sees all USAV rows) and only adds
-- isolation for future tenants. Guarded per table; revert: relax_tenant_isolation('<t>').
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff','staff_sessions','email_login_tokens'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'backstop_wave9: skip % (does not exist)', t; CONTINUE;
    END IF;
    BEGIN
      PERFORM enforce_tenant_isolation(t);
      RAISE NOTICE 'backstop_wave9: FORCEd %', t;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'backstop_wave9: enforce(%) failed: % — left unforced', t, SQLERRM;
    END;
  END LOOP;
END $$;
