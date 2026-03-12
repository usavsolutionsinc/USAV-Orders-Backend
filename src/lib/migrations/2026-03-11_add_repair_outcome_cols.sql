-- Add repair-specific tracking columns to work_assignments.
--
-- out_of_stock : free-text description of a missing part blocking the repair
--                (mirrors orders.out_of_stock pattern; stored on the wa row
--                 so it stays with the assignment lifecycle, not the repair record)
--
-- repair_outcome : tech's description of what was found / performed when they
--                  start or complete the repair (set alongside status → IN_PROGRESS)

ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS out_of_stock   TEXT,
  ADD COLUMN IF NOT EXISTS repair_outcome TEXT;

-- Optional: index for dashboards that filter on out_of_stock repairs
CREATE INDEX IF NOT EXISTS idx_wa_repair_out_of_stock
  ON work_assignments (entity_type, work_type, out_of_stock)
  WHERE out_of_stock IS NOT NULL;
