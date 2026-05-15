-- ============================================================================
-- 2026-05-14: SSO foundation
-- ============================================================================
-- Two columns on staff so a future SSO provider (Microsoft Entra, Clerk,
-- Auth.js, …) can map an authenticated subject to our internal staff row.
--
-- We deliberately don't pick a provider in schema — `sso_subject` is provider-
-- opaque (Entra: `oid`, Clerk: user_id, Google: `sub`). The middleware that
-- consumes this column lives in its own follow-up PR.
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS sso_subject  TEXT,
  ADD COLUMN IF NOT EXISTS sso_provider TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_sso_subject
  ON staff(sso_provider, sso_subject)
  WHERE sso_subject IS NOT NULL;

COMMENT ON COLUMN staff.sso_subject  IS 'Provider-opaque subject id (Entra oid / Clerk user_id / etc).';
COMMENT ON COLUMN staff.sso_provider IS 'Identity provider name (entra, clerk, authjs, ...). Paired with sso_subject for uniqueness.';

COMMIT;
