-- ============================================================================
-- 2026-05-20: staff.sort_order for the Access sidebar drag-to-reorder.
-- ============================================================================
-- Initial seed = staff.id so existing order is preserved when the sidebar
-- switches from name-sort to sort_order-sort. Admins reorder via the UI
-- (POST /api/admin/staff/reorder) afterwards; new staff land at sort_order=0
-- and float to the top of the list (deliberate — fresh hires get attention).
-- ============================================================================

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE staff SET sort_order = id WHERE sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_staff_sort_order ON staff(sort_order, name);

COMMENT ON COLUMN staff.sort_order IS 'Admin-controlled order for the Access sidebar. Lower = earlier. New staff start at 0 and float to the top.';

COMMIT;
