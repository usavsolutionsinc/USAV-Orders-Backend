-- repair_actions — structured log of every physical step a tech performs on a
-- repair. Status transitions live in repair_service.status_history; this table
-- captures the work itself (parts swapped, cleanings, tests, no-fix outcomes).
-- The printed receipt's "Internal Use" block reads from here, and the mobile
-- /m/rs/{id} page is the primary entry point.

CREATE TABLE IF NOT EXISTS repair_actions (
  id            SERIAL PRIMARY KEY,
  repair_id     INTEGER NOT NULL REFERENCES repair_service(id) ON DELETE CASCADE,
  action_type   TEXT NOT NULL,
  part_name     TEXT,
  old_sku       TEXT,
  new_sku       TEXT,
  old_serial    TEXT,
  new_serial    TEXT,
  duration_min  INTEGER,
  notes         TEXT,
  staff_id      INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- Soft-delete-aware index for the timeline view.
CREATE INDEX IF NOT EXISTS idx_repair_actions_repair_id
  ON repair_actions (repair_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Per-tech reporting ("actions logged by tech X this week").
CREATE INDEX IF NOT EXISTS idx_repair_actions_staff_id
  ON repair_actions (staff_id, created_at DESC)
  WHERE staff_id IS NOT NULL AND deleted_at IS NULL;
