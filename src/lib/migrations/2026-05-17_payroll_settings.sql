-- ============================================================================
-- 2026-05-17: Payroll settings (singleton)
-- ============================================================================
-- Single-row config that the admin payroll UI edits. Holds:
--   • Default lunch window (12:30 PM – 1:00 PM, 30 min)
--   • Daily / weekly overtime thresholds + multipliers (CA defaults: 8/40 hr,
--     1.5x OT, 12 hr/day 2x double-time)
--   • Shop timezone (defaults to America/Los_Angeles)
--
-- Why a singleton table instead of a key/value config?
--   • Typed columns survive the years better than `value TEXT`.
--   • A simple CHECK (id = 1) makes "you only get one config row" a DB-level
--     invariant, not a code convention.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS payroll_settings (
  id                                INT  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_break_minutes             INT  NOT NULL DEFAULT 30
                                    CHECK (default_break_minutes >= 0 AND default_break_minutes <= 240),
  default_lunch_start_minute        INT  NOT NULL DEFAULT 750   -- 12:30 PM (12*60 + 30)
                                    CHECK (default_lunch_start_minute BETWEEN 0 AND 1439),
  default_lunch_end_minute          INT  NOT NULL DEFAULT 780   -- 1:00 PM
                                    CHECK (default_lunch_end_minute BETWEEN 1 AND 1440),
  overtime_daily_threshold_minutes  INT  NOT NULL DEFAULT 480   -- 8 hr
                                    CHECK (overtime_daily_threshold_minutes >= 0),
  overtime_weekly_threshold_minutes INT  NOT NULL DEFAULT 2400  -- 40 hr
                                    CHECK (overtime_weekly_threshold_minutes >= 0),
  overtime_multiplier               NUMERIC(4,2) NOT NULL DEFAULT 1.50
                                    CHECK (overtime_multiplier >= 1.0 AND overtime_multiplier <= 5.0),
  double_time_daily_threshold_minutes INT NOT NULL DEFAULT 720  -- 12 hr (CA)
                                    CHECK (double_time_daily_threshold_minutes >= 0),
  double_time_multiplier            NUMERIC(4,2) NOT NULL DEFAULT 2.00
                                    CHECK (double_time_multiplier >= 1.0 AND double_time_multiplier <= 5.0),
  timezone                          TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  updated_by                        INT  REFERENCES staff(id) ON DELETE SET NULL,
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_settings_lunch_window_chk CHECK (default_lunch_end_minute > default_lunch_start_minute)
);

-- Seed the singleton row with defaults.
INSERT INTO payroll_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE payroll_settings IS
  'Singleton row (id=1) holding shop-wide payroll defaults: break window, OT/DT thresholds + multipliers. Edited from admin payroll UI.';

COMMIT;
