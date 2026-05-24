-- ============================================================================
-- 2026-05-23: Per-staff toggle for the mobile bottom navigation bar
-- ============================================================================
-- Pairs with src/lib/mobile-navigation.ts. Most staff benefit from the
-- role-aware bottom nav (a packer sees Pack + Scan + Picks; a technician
-- sees Test). For tightly-scoped roles — kiosk-style packers, single-station
-- receivers — admins want to lock the device to one page and remove every
-- navigation affordance so the operator can't accidentally tap into another
-- section.
--
--   • staff.mobile_bottom_nav_enabled = TRUE  → render the role-aware bar (default)
--   • staff.mobile_bottom_nav_enabled = FALSE → hide the bar entirely; the
--                                               mobile header swaps the
--                                               hamburger for a sign-out
--                                               button so the user can still
--                                               end their shift.
--
-- Defaults to TRUE so existing staff keep their current experience until an
-- admin opts a row out.
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS mobile_bottom_nav_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN staff.mobile_bottom_nav_enabled IS
  'When FALSE, the mobile bottom tab bar is suppressed for this staff. The mobile header swaps its hamburger for a sign-out button. Used to lock kiosk-style operators to a single page.';

COMMIT;
