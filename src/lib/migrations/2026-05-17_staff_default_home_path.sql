-- ============================================================================
-- 2026-05-17: Per-staff default home page
-- ============================================================================
-- Most staff use one section of the app most of the time — packers land in
-- /packer, receivers in /receiving, etc. The old behavior was to redirect
-- to the role's default (ROLE_HOME in src/app/signin/page.tsx), which
-- forces every packer to the same path even if the shop wants Sang to land
-- on /tech and Tuan on /packer.
--
-- This column lets admins override per staff:
--   • staff.default_home_path = '/packer'     → that staffer lands there
--   • staff.default_home_path = NULL          → fall back to ROLE_HOME[role]
--
-- A query-string `?next=` on /signin still beats this override (you came
-- from a deep link and we want to land you back there).
-- ============================================================================

BEGIN;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS default_home_path TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'staff'::regclass AND conname = 'staff_default_home_path_chk'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_default_home_path_chk
      CHECK (default_home_path IS NULL OR default_home_path LIKE '/%');
  END IF;
END $$;

COMMENT ON COLUMN staff.default_home_path IS
  'Optional per-staff override for post-signin redirect. NULL falls back to ROLE_HOME[role]. Must start with "/" when set.';

COMMIT;
