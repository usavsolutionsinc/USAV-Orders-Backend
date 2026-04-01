-- Week-level forward scheduling plan (Monday-based weeks, PST semantics in app).
CREATE TABLE IF NOT EXISTS staff_week_plans (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_scheduled BOOLEAN NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, week_start_date, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_staff_week_plans_week_staff
  ON staff_week_plans(week_start_date, staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_week_plans_staff_week
  ON staff_week_plans(staff_id, week_start_date);
