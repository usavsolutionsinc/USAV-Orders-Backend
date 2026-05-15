-- ============================================================================
-- 2026-05-14: Staff roles (RBAC foundations)
-- ============================================================================
-- Adopts the existing role taxonomy (packer, receiving, technician, sales)
-- and adds two new tiers:
--   • 'admin'    — destructive actions (rename, swap, remove, variance approval)
--   • 'readonly' — disables all writes for visitors / auditors
--
-- Existing rows keep their role unchanged. The check constraint is the only
-- thing this migration adds.
-- ============================================================================

BEGIN;

-- Defensive: column should already exist on this DB, but on a fresh DB the
-- ADD COLUMN runs idempotently. Keep nullable to match the existing schema.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'staff'::regclass AND conname = 'staff_role_chk'
  ) THEN
    ALTER TABLE staff
      ADD CONSTRAINT staff_role_chk
      CHECK (role IS NULL OR role IN (
        'packer','receiving','technician','sales','admin','readonly'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role) WHERE role IS NOT NULL;

COMMENT ON COLUMN staff.role IS
  'RBAC bucket. packer/receiving/technician/sales can read+adjust. admin can rename/swap/remove. readonly disables writes.';

COMMIT;
