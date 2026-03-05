-- Migration: Split work_assignments.assignee_staff_id into assigned_tech_id + assigned_packer_id
--            Remove orders.tester_id and orders.packer_id (assignment now in work_assignments)
-- Date: 2026-03-05

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WORK_ASSIGNMENTS: rename assignee_staff_id → assigned_tech_id
--    and add assigned_packer_id
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE work_assignments
  RENAME COLUMN assignee_staff_id TO assigned_tech_id;

ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS assigned_packer_id INTEGER REFERENCES staff(id) ON DELETE SET NULL;

-- For existing PACK-type rows: move assigned_tech_id → assigned_packer_id and clear tech column.
UPDATE work_assignments
SET
  assigned_packer_id = assigned_tech_id,
  assigned_tech_id   = NULL
WHERE work_type = 'PACK'
  AND assigned_tech_id IS NOT NULL;

-- Drop old unique index (references old column name, will need recreating)
DROP INDEX IF EXISTS idx_work_assignments_active_unique;

-- Recreate the active-unique index using whichever assignee is populated
-- A single entity/work_type pair should have at most one ASSIGNED or IN_PROGRESS row
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_assignments_active_unique
  ON work_assignments (entity_type, entity_id, work_type)
  WHERE status IN ('ASSIGNED', 'IN_PROGRESS');

-- Index on assigned_tech_id for fast look-ups
CREATE INDEX IF NOT EXISTS idx_work_assignments_tech_id
  ON work_assignments (assigned_tech_id)
  WHERE assigned_tech_id IS NOT NULL;

-- Index on assigned_packer_id for fast look-ups
CREATE INDEX IF NOT EXISTS idx_work_assignments_packer_id
  ON work_assignments (assigned_packer_id)
  WHERE assigned_packer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ORDERS: migrate existing tester_id / packer_id into work_assignments
--    before dropping the columns
-- ─────────────────────────────────────────────────────────────────────────────

-- Migrate tester_id → work_assignments (entity_type=ORDER, work_type=TEST)
-- Only insert if no active TEST assignment already exists for that order.
INSERT INTO work_assignments (entity_type, entity_id, work_type, assigned_tech_id, status, priority, notes)
SELECT
  'ORDER',
  o.id,
  'TEST',
  o.tester_id,
  'ASSIGNED',
  100,
  'Migrated from orders.tester_id'
FROM orders o
WHERE o.tester_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM work_assignments wa
    WHERE wa.entity_type = 'ORDER'
      AND wa.entity_id   = o.id
      AND wa.work_type   = 'TEST'
      AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
  )
ON CONFLICT DO NOTHING;

-- Migrate packer_id → work_assignments (entity_type=ORDER, work_type=PACK)
INSERT INTO work_assignments (entity_type, entity_id, work_type, assigned_packer_id, status, priority, notes)
SELECT
  'ORDER',
  o.id,
  'PACK',
  o.packer_id,
  'ASSIGNED',
  100,
  'Migrated from orders.packer_id'
FROM orders o
WHERE o.packer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM work_assignments wa
    WHERE wa.entity_type = 'ORDER'
      AND wa.entity_id   = o.id
      AND wa.work_type   = 'PACK'
      AND wa.status IN ('ASSIGNED', 'IN_PROGRESS')
  )
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DROP tester_id and packer_id from orders
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop indexes that reference these columns (if they exist)
DROP INDEX IF EXISTS idx_orders_tester_id;
DROP INDEX IF EXISTS idx_orders_packer_id;

ALTER TABLE orders
  DROP COLUMN IF EXISTS tester_id,
  DROP COLUMN IF EXISTS packer_id;

COMMIT;
