-- Unified assignment queue across orders, repair, FBA, and receiving.

DO $$
BEGIN
  CREATE TYPE work_entity_type_enum AS ENUM ('ORDER', 'REPAIR', 'FBA_SHIPMENT', 'RECEIVING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE work_type_enum AS ENUM ('TEST', 'PACK', 'REPAIR', 'QA', 'RECEIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE assignment_status_enum AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS work_assignments (
  id SERIAL PRIMARY KEY,
  entity_type work_entity_type_enum NOT NULL,
  entity_id INTEGER NOT NULL,
  work_type work_type_enum NOT NULL,
  assignee_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status assignment_status_enum NOT NULL DEFAULT 'ASSIGNED',
  priority INTEGER NOT NULL DEFAULT 100,
  notes TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_assignments_assignee_status
  ON work_assignments(assignee_staff_id, status, work_type, priority, assigned_at);

CREATE INDEX IF NOT EXISTS idx_work_assignments_entity
  ON work_assignments(entity_type, entity_id, work_type, status);

-- One active assignment per entity/work_type at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_work_assignments_active_entity
  ON work_assignments(entity_type, entity_id, work_type)
  WHERE status IN ('ASSIGNED', 'IN_PROGRESS');
