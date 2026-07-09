-- ============================================================================
-- 2026-06-28: staff_auth_policy — per-staff sign-in method + sensitive wall
-- ============================================================================
-- WS6.1. Two additive, per-staff policy knobs an admin/owner can flip:
--
--   auth_method                'pin' (default) | 'password'
--       When 'password', the staff member may NOT sign in via the org-scoped
--       station PIN path (/api/auth/signin). The PIN handler refuses with
--       AUTH_METHOD_PASSWORD_REQUIRED and directs them to the account
--       (email + password) entry point (/api/auth/account/signin). Existing
--       staff default to 'pin', so every current sign-in is unchanged.
--
--   requires_sensitive_stepup  boolean, default false
--       When true, the "sensitive-information wall" forces a fresh step-up
--       re-auth (reusing the existing staff_stepups grant + TTL mechanism)
--       before the staff member may hit a guarded sensitive surface. The
--       server guard is src/lib/auth/sensitive-stepup.ts (requireSensitiveStepUp).
--       Default false → no wall → existing behavior preserved.
--
-- `staff` is an org-scoped, tenant-owned table (carries organization_id and is
-- already covered by enforce_tenant_isolation()/FORCE RLS). These columns
-- inherit that scoping automatically — NO new RLS / policy change is needed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK so re-runs are no-ops.
--
-- ROLLBACK:
--   ALTER TABLE staff DROP COLUMN IF EXISTS requires_sensitive_stepup;
--   ALTER TABLE staff DROP COLUMN IF EXISTS auth_method;
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS auth_method TEXT NOT NULL DEFAULT 'pin';

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS requires_sensitive_stepup BOOLEAN NOT NULL DEFAULT false;

-- Constrain auth_method to the supported vocabulary.
DO $$ BEGIN
  ALTER TABLE staff
    ADD CONSTRAINT staff_auth_method_chk
    CHECK (auth_method IN ('pin', 'password'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN staff.auth_method IS
  'Sign-in method policy: ''pin'' (default, station PIN path) | ''password'' (must use the account email+password path; PIN signin refuses with AUTH_METHOD_PASSWORD_REQUIRED). WS6.1.';

COMMENT ON COLUMN staff.requires_sensitive_stepup IS
  'When true, the sensitive-information wall forces a fresh step-up re-auth (staff_stepups grant) before guarded sensitive surfaces. Enforced by src/lib/auth/sensitive-stepup.ts. Default false preserves existing behavior. WS6.1.';

COMMIT;
