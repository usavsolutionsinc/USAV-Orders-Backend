-- ============================================================================
-- 2026-06-28_app_tenant_grants_reaffirm.sql
--
-- Phase E1 keystone — RECORDED, idempotent, SECRET-FREE follow-up to the
-- (deliberately manual) 2026-06-21_app_tenant_role.sql.template.
--
-- The `app_tenant` LOGIN role itself is created MANUALLY and ONCE per database,
-- because it carries a password that must NEVER be committed (CLAUDE.md safety
-- rule). On this database it already exists (rolbypassrls=f, rolsuper=f) and the
-- runtime connects through it via TENANT_APP_DATABASE_URL, so RLS genuinely
-- enforces. This migration does NOT create the role and sets NO password.
--
-- What it DOES (all idempotent, owner-run): re-affirm the privilege grants and
-- default privileges so that (a) on this DB it is a safe no-op, and (b) a fresh
-- tenant database reaches a correct, reachable state after the operator performs
-- the single manual step `CREATE ROLE app_tenant LOGIN PASSWORD '…' NOBYPASSRLS`.
-- Without re-affirming default privileges, the NEXT migration's new table would
-- be invisible to app_tenant (SELECT/INSERT denied) — the classic onboarding bug.
--
-- If the role is absent (fresh DB, pre-manual-step) this migration logs and
-- no-ops rather than failing the whole migration run.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    RAISE NOTICE 'app_tenant role absent — run 2026-06-21_app_tenant_role.sql.template first (manual, password-bearing). Skipping grants.';
    RETURN;
  END IF;

  -- Defense-in-depth: the runtime role must never be able to bypass RLS.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant' AND rolbypassrls) THEN
    RAISE EXCEPTION 'app_tenant has BYPASSRLS — tenant isolation would be inert. Run ALTER ROLE app_tenant NOBYPASSRLS;';
  END IF;

  GRANT USAGE ON SCHEMA public TO app_tenant;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_tenant;

  -- Future objects created by the migration owner stay reachable by the runtime role.
  ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
  ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;
  ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO app_tenant;

  RAISE NOTICE 'app_tenant grants + default privileges re-affirmed.';
END $$;
