BEGIN;

CREATE TABLE IF NOT EXISTS staff_availability_rules (
  id BIGSERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('weekday_allowed', 'date_block', 'date_allow')),
  day_of_week SMALLINT,
  is_allowed BOOLEAN NOT NULL DEFAULT true,
  effective_start_date DATE,
  effective_end_date DATE,
  priority INTEGER NOT NULL DEFAULT 100,
  reason TEXT,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT staff_availability_rules_day_of_week_check
    CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
  CONSTRAINT staff_availability_rules_range_check
    CHECK (
      effective_start_date IS NULL
      OR effective_end_date IS NULL
      OR effective_end_date >= effective_start_date
    ),
  CONSTRAINT staff_availability_rules_weekday_required_check
    CHECK (
      (rule_type = 'weekday_allowed' AND day_of_week IS NOT NULL)
      OR (rule_type IN ('date_block', 'date_allow'))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_availability_rules_unique_active_idx
ON staff_availability_rules (
  staff_id,
  rule_type,
  COALESCE(day_of_week, -1),
  COALESCE(effective_start_date, DATE '0001-01-01'),
  COALESCE(effective_end_date, DATE '9999-12-31')
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_availability_rules_staff_active_idx
ON staff_availability_rules (staff_id, deleted_at, priority);

CREATE INDEX IF NOT EXISTS staff_availability_rules_weekday_idx
ON staff_availability_rules (staff_id, day_of_week)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_availability_rules_date_window_idx
ON staff_availability_rules (effective_start_date, effective_end_date)
WHERE deleted_at IS NULL;

INSERT INTO staff_availability_rules (
  staff_id,
  rule_type,
  day_of_week,
  is_allowed,
  priority,
  reason
)
SELECT
  sws.staff_id,
  'weekday_allowed',
  sws.day_of_week,
  sws.is_scheduled,
  100,
  'Backfilled from staff_weekly_schedule'
FROM staff_weekly_schedule sws
ON CONFLICT DO NOTHING;

COMMIT;
