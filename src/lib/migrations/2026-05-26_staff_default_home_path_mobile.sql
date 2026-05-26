-- ============================================================================
-- 2026-05-26: Per-staff default home page (mobile)
-- ============================================================================
-- Sibling of 2026-05-17_staff_default_home_path.sql. The original column
-- (default_home_path) is used for desktop sign-in; mobile sign-in now has a
-- separate override so the same staffer can land on /receiving on a station
-- PC and /m/receiving on their phone — or any other combination.
--
-- Precedence (matches desktop):
--   1. ?next= deep link
--   2. staff.default_home_path_mobile  (this column, mobile devices only)
--   3. MOBILE_ROLE_HOME[role]
--   4. /m/home
-- ============================================================================

BEGIN;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS default_home_path_mobile TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'staff'::regclass AND conname = 'staff_default_home_path_mobile_chk'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_default_home_path_mobile_chk
      CHECK (default_home_path_mobile IS NULL OR default_home_path_mobile LIKE '/%');
  END IF;
END $$;

COMMENT ON COLUMN staff.default_home_path_mobile IS
  'Optional per-staff override for post-signin redirect on mobile devices. NULL falls back to MOBILE_ROLE_HOME[role]. Must start with "/" when set.';

COMMIT;
