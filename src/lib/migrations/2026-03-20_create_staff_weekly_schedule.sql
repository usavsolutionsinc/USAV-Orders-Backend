-- Weekly availability schedule for staffing-aware assignment flows.
CREATE TABLE IF NOT EXISTS staff_weekly_schedule (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_scheduled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, day_of_week)
);

-- Seed all existing staff to "scheduled" for all days so rollout is non-breaking.
INSERT INTO staff_weekly_schedule (staff_id, day_of_week, is_scheduled)
SELECT s.id, d.day_of_week, true
FROM staff s
CROSS JOIN generate_series(0, 6) AS d(day_of_week)
ON CONFLICT (staff_id, day_of_week) DO NOTHING;
