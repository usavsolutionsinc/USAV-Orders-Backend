-- Per-staff header to-do lists (general + recurring), backing the header goal
-- chip's "Recurring" and "To-do" modes (previously localStorage-only v1).
--
-- Recurrence model: a recurring task stores its cadence (interval + cycle
-- anchor) and NEVER stores a done flag. "Done this cycle" is derived from
-- staff_todo_completions: a task is checked when its latest completion falls
-- inside the current cycle (anchor + n·interval). No cron, no reset job —
-- rollover is pure read-time math, and the completion log doubles as history.
--
-- Distinct from the dead legacy task_templates/daily_task_instances family in
-- schema.sql (unused by any code) — do not extend those.

CREATE TABLE IF NOT EXISTS staff_todos (
  id BIGSERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  -- Station scope (TECH/PACK/...). NULL reserved for future station-less lists;
  -- the header chip always sets it.
  station TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('general', 'recurring')),
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- recurring only: cycle length + anchor of the current cycle's origin.
  recur_interval_ms BIGINT,
  recur_anchor TIMESTAMPTZ,
  -- general only: checked state (NULL = open).
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft delete so completion history survives task removal.
  archived_at TIMESTAMPTZ,
  CONSTRAINT staff_todos_recurring_fields CHECK (
    kind <> 'recurring' OR (recur_interval_ms > 0 AND recur_anchor IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_todos_staff_station
  ON staff_todos (staff_id, station)
  WHERE archived_at IS NULL;

-- Check-off log for recurring tasks. One row per check; the latest row inside
-- the task's current cycle means "done". Unchecking deletes the current
-- cycle's rows (prior cycles are immutable history).
CREATE TABLE IF NOT EXISTS staff_todo_completions (
  id BIGSERIAL PRIMARY KEY,
  todo_id BIGINT NOT NULL REFERENCES staff_todos(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_todo_completions_todo_time
  ON staff_todo_completions (todo_id, completed_at DESC);
