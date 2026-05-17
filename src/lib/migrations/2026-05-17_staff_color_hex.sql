-- ============================================================================
-- 2026-05-17: Staff color_hex — per-staff theme color stored in DB
-- ============================================================================
-- Up until now, the staff theme was a hardcoded id→name map in
-- src/utils/staff-colors.ts. New hires got no color (or default green) and
-- admins couldn't change colors without a deploy. This adds a `color_hex`
-- column so the color picker on the admin staff page is the source of truth.
--
-- Seed: the eight existing staff (ids 1-8) get colors matching the previous
-- hardcoded map so the visible UI doesn't change after migration. Everyone
-- else gets emerald (the default in getStaffThemeById's fallback).
-- ============================================================================

BEGIN;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS color_hex CHAR(7);

UPDATE staff SET color_hex = '#10b981' WHERE id = 1 AND color_hex IS NULL;  -- Michael — emerald
UPDATE staff SET color_hex = '#3b82f6' WHERE id = 2 AND color_hex IS NULL;  -- Thuc   — blue
UPDATE staff SET color_hex = '#a855f7' WHERE id = 3 AND color_hex IS NULL;  -- Sang   — purple
UPDATE staff SET color_hex = '#1f2937' WHERE id = 4 AND color_hex IS NULL;  -- Tuan   — slate (black)
UPDATE staff SET color_hex = '#ef4444' WHERE id = 5 AND color_hex IS NULL;  -- Thuy   — red
UPDATE staff SET color_hex = '#f59e0b' WHERE id = 6 AND color_hex IS NULL;  -- Cuong  — amber (yellow)
UPDATE staff SET color_hex = '#0ea5e9' WHERE id = 7 AND color_hex IS NULL;  -- Kai    — sky (lightblue)
UPDATE staff SET color_hex = '#ec4899' WHERE id = 8 AND color_hex IS NULL;  -- Lien   — pink

UPDATE staff SET color_hex = '#10b981' WHERE color_hex IS NULL;

ALTER TABLE staff ALTER COLUMN color_hex SET NOT NULL;
ALTER TABLE staff ALTER COLUMN color_hex SET DEFAULT '#10b981';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'staff'::regclass AND conname = 'staff_color_hex_chk'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_color_hex_chk
      CHECK (color_hex ~ '^#[0-9a-fA-F]{6}$');
  END IF;
END $$;

COMMENT ON COLUMN staff.color_hex IS
  'Per-staff theme color. Drives avatar tint on the signin picker, PIN halo, FAB chip, and station chrome (via nearest-theme matching).';

COMMIT;
