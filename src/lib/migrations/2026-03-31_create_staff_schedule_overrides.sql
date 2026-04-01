-- Date-specific staff schedule overrides (non-recurring).
-- Used to avoid weekly-template edits affecting future weeks unintentionally.
CREATE TABLE IF NOT EXISTS staff_schedule_overrides (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  is_scheduled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, schedule_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedule_overrides_date
  ON staff_schedule_overrides(schedule_date, staff_id);
