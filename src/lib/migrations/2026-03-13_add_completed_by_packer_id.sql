-- Add completed_by_packer_id to work_assignments.
--
-- Mirrors the existing completed_by_tech_id column.
-- Records which packer explicitly completed (shipped) a PACK work assignment
-- via the management UI ("Mark as Shipped" button in the work orders card).
--
-- Distinct from packer_logs.packed_by, which records the physical scan-station
-- actor and serves as the authoritative shipped/pending filter for order views.
-- completed_by_packer_id covers the management-click code path only.

ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS completed_by_packer_id INTEGER
    REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN work_assignments.completed_by_packer_id IS
  'Packer who completed (shipped) this PACK assignment via the management UI. '
  'Set when status transitions to DONE on a PACK row. '
  'Distinct from packer_logs.packed_by (scanner station actor).';

-- Index: fast lookup of "all PACK assignments completed by packer X"
CREATE INDEX IF NOT EXISTS idx_wa_completed_by_packer
  ON work_assignments (completed_by_packer_id, work_type, completed_at DESC)
  WHERE completed_by_packer_id IS NOT NULL;
