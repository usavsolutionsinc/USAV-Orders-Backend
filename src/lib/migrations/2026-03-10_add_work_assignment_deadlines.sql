-- Phase 1: Add deadline_at to work_assignments and seed canonical OPEN TEST rows.
-- Do NOT drop orders.ship_by_date in this deployment.

BEGIN;

-- 1. Add OPEN status for canonical unassigned queue rows.
DO $$
BEGIN
  ALTER TYPE assignment_status_enum ADD VALUE IF NOT EXISTS 'OPEN';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add deadline_at to work_assignments.
ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

-- 3. Replace unique index to cover OPEN/ASSIGNED/IN_PROGRESS (one active row per entity/work_type).
DROP INDEX IF EXISTS ux_work_assignments_active_entity;
DROP INDEX IF EXISTS idx_work_assignments_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS ux_work_assignments_active_entity
  ON work_assignments(entity_type, entity_id, work_type)
  WHERE status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS');

-- 4. Queue/sort index for deadline-driven ordering.
CREATE INDEX IF NOT EXISTS idx_work_assignments_deadline_queue
  ON work_assignments(entity_type, work_type, status, assigned_tech_id, assigned_packer_id, deadline_at, priority, assigned_at);

-- 5. Backfill deadline_at on existing ORDER TEST/PACK rows from orders.ship_by_date.
UPDATE work_assignments wa
SET
  deadline_at = o.ship_by_date,
  updated_at  = NOW()
FROM orders o
WHERE wa.entity_type = 'ORDER'
  AND wa.entity_id   = o.id
  AND wa.work_type   IN ('TEST', 'PACK')
  AND o.ship_by_date IS NOT NULL
  AND wa.deadline_at IS DISTINCT FROM o.ship_by_date;

-- 6. Create canonical OPEN TEST rows for every order that lacks an active TEST row.
--    Covers unassigned orders and provides historical deadline source for shipped orders.
INSERT INTO work_assignments (
  entity_type,
  entity_id,
  work_type,
  assigned_tech_id,
  status,
  priority,
  deadline_at,
  notes,
  assigned_at,
  created_at,
  updated_at
)
SELECT
  'ORDER',
  o.id,
  'TEST',
  NULL,
  'OPEN',
  100,
  o.ship_by_date,
  'Canonical deadline row migrated from orders.ship_by_date',
  COALESCE(o.created_at, NOW()),
  COALESCE(o.created_at, NOW()),
  NOW()
FROM orders o
WHERE NOT EXISTS (
  SELECT 1
  FROM work_assignments wa
  WHERE wa.entity_type = 'ORDER'
    AND wa.entity_id   = o.id
    AND wa.work_type   = 'TEST'
    AND wa.status      IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
);

COMMIT;
