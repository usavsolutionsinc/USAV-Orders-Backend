-- ============================================================================
-- 2026-05-17: Inventory v2 — Phase 1
-- ============================================================================
-- Schema delta for Phase 1 (GS1 Digital Link scan resolver + label print).
-- The application-layer work (scan parser, /api/print/dispatch class=unit,
-- public scan routes) doesn't need DB changes; this migration just extends
-- the printer_profiles default_for CHECK so 'unit' is a recognized label
-- class for printer routing.
-- ============================================================================

BEGIN;

ALTER TABLE printer_profiles
  DROP CONSTRAINT IF EXISTS printer_profiles_default_for_chk;

ALTER TABLE printer_profiles
  ADD CONSTRAINT printer_profiles_default_for_chk
  CHECK (default_for IS NULL OR default_for IN ('carton','product','bin','unit'));

COMMENT ON COLUMN printer_profiles.default_for IS
  'Default label class for routing in /api/print/dispatch. carton | product | bin | unit. NULL = generic.';

COMMIT;
