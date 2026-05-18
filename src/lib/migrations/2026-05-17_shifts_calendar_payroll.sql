-- ============================================================================
-- 2026-05-17: Shifts, time-clock, and payroll foundation
-- ============================================================================
-- Replaces the boolean "is_scheduled per weekday" model
-- (staff_weekly_schedule + staff_week_plans + staff_schedule_overrides) with
-- a real shift-instance model that scales into payroll and time-tracking
-- without changing the data model again.
--
-- Tables added (in dependency order):
--   1. shift_templates       — recurring rule ("Michael, Mon-Fri, 9-5 PT")
--   2. shifts                — actual one-day assignments derived from
--                              templates or manually scheduled
--   3. time_punches          — clock in/out events (real worked time)
--   4. staff_pay_rates       — historical hourly rate per staff
--   5. pay_periods           — payroll batching (open/finalized/paid)
--   6. time_off_requests     — vacation/sick/personal — denies templates
--                              from materializing shifts inside the window
--
-- The old staff_weekly_schedule / staff_week_plans / staff_schedule_overrides
-- tables stay alive during the rollout. shift_templates is seeded from the
-- current staff_weekly_schedule rows at default 9 AM – 5 PM PT so the
-- calendar renders the same shifts on day one.
--
-- Postgres extensions:
--   • btree_gist — required for the exclusion constraint that prevents
--     a single staff being double-booked across overlapping active shifts.
-- ============================================================================

BEGIN;

-- Required for the EXCLUDE USING gist constraint on `shifts` below.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─── 1. shift_templates ────────────────────────────────────────────────────
-- One row per staff × weekday combination. Drives materialization of
-- future shifts. Hours stored as minutes-from-midnight in the staff's
-- local timezone so DST shifts don't need a schema change.

CREATE TABLE IF NOT EXISTS shift_templates (
  id                 SERIAL PRIMARY KEY,
  staff_id           INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week        INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  starts_at_minute   INT NOT NULL CHECK (starts_at_minute BETWEEN 0 AND 1439),
  ends_at_minute     INT NOT NULL CHECK (ends_at_minute  BETWEEN 1 AND 1440),
  timezone           TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  location_id        INT,  -- FK added below if locations table exists
  effective_from     DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to       DATE,
  notes              TEXT,
  created_by         INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_templates_hours_chk CHECK (ends_at_minute > starts_at_minute),
  CONSTRAINT shift_templates_effective_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_staff_day
  ON shift_templates(staff_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_shift_templates_active
  ON shift_templates(staff_id, day_of_week)
  WHERE effective_to IS NULL;

COMMENT ON TABLE shift_templates IS
  'Recurring shift rule per (staff, weekday). Source-of-truth for "Michael works Mon-Fri 9-5". Materialized into shifts rows for the visible calendar window.';

-- Wire location FK if locations table exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'locations') THEN
    ALTER TABLE shift_templates
      ADD CONSTRAINT shift_templates_location_fk
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. shifts ─────────────────────────────────────────────────────────────
-- Concrete shift instance. Either materialized from a template_id or
-- created manually (template_id IS NULL). Status flows:
--   planned   → confirmed   → in_progress → completed
--                            → missed
--                            → cancelled (e.g. covered by another shift)

CREATE TABLE IF NOT EXISTS shifts (
  id                BIGSERIAL PRIMARY KEY,
  staff_id          INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','confirmed','in_progress','completed','cancelled','missed')),
  template_id       INT REFERENCES shift_templates(id) ON DELETE SET NULL,
  covers_shift_id   BIGINT REFERENCES shifts(id) ON DELETE SET NULL,
  location_id       INT,  -- FK added below if locations table exists
  notes             TEXT,
  created_by        INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shifts_times_chk CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_shifts_staff_starts
  ON shifts(staff_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_shifts_starts_ends_active
  ON shifts(starts_at, ends_at)
  WHERE status NOT IN ('cancelled', 'missed');

CREATE INDEX IF NOT EXISTS idx_shifts_covers
  ON shifts(covers_shift_id)
  WHERE covers_shift_id IS NOT NULL;

-- A single staff can't be on two overlapping non-cancelled shifts at once.
-- Uses btree_gist to mix the equality test on staff_id with the range
-- overlap test on the shift window.
ALTER TABLE shifts
  ADD CONSTRAINT shifts_no_overlap_per_staff
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'missed'));

COMMENT ON TABLE shifts IS
  'Concrete shift instance for one staff in one time window. The DB''s authority on "is this person working now?" — drives session expiry and payroll.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'locations') THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_location_fk
      FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── 3. time_punches ───────────────────────────────────────────────────────
-- Actual clock-in / clock-out. shifts.starts_at is the *planned* time;
-- time_punches.punched_in_at is the *real* time. Payroll uses punches,
-- scheduling uses shifts.

CREATE TABLE IF NOT EXISTS time_punches (
  id                BIGSERIAL PRIMARY KEY,
  staff_id          INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_id          BIGINT REFERENCES shifts(id) ON DELETE SET NULL,
  punched_in_at     TIMESTAMPTZ NOT NULL,
  punched_out_at    TIMESTAMPTZ,
  break_minutes     INT NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  source            TEXT NOT NULL DEFAULT 'pin'
                    CHECK (source IN ('pin','passkey','badge','admin_override','auto_close')),
  edited_by         INT REFERENCES staff(id) ON DELETE SET NULL,
  edited_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT time_punches_times_chk CHECK (
    punched_out_at IS NULL OR punched_out_at > punched_in_at
  )
);

CREATE INDEX IF NOT EXISTS idx_time_punches_staff_in
  ON time_punches(staff_id, punched_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_punches_shift
  ON time_punches(shift_id);

-- A staff can only have one open (not-clocked-out) punch at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_punches_one_open
  ON time_punches(staff_id)
  WHERE punched_out_at IS NULL;

COMMENT ON TABLE time_punches IS
  'Real clock-in/out events. Source-of-truth for payroll hours.';

-- ─── 4. staff_pay_rates ────────────────────────────────────────────────────
-- Historical hourly rate. effective_to IS NULL means "current rate".
-- Payroll computes hours × rate-effective-at-that-time so retroactive
-- changes don't rewrite past pay.

CREATE TABLE IF NOT EXISTS staff_pay_rates (
  id              BIGSERIAL PRIMARY KEY,
  staff_id        INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  hourly_cents    INT NOT NULL CHECK (hourly_cents >= 0),
  effective_from  DATE NOT NULL,
  effective_to    DATE,
  notes           TEXT,
  created_by      INT REFERENCES staff(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_pay_rates_effective_chk CHECK (
    effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_pay_rates_staff_eff
  ON staff_pay_rates(staff_id, effective_from DESC);

-- Exactly one open rate per staff at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_pay_rates_open
  ON staff_pay_rates(staff_id)
  WHERE effective_to IS NULL;

COMMENT ON TABLE staff_pay_rates IS
  'Historical hourly rate per staff. Payroll uses rate effective during each punch.';

-- ─── 5. pay_periods ────────────────────────────────────────────────────────
-- Optional batch container. Most shops use bi-weekly periods. Status
-- transitions: open → review → finalized → paid.

CREATE TABLE IF NOT EXISTS pay_periods (
  id              SERIAL PRIMARY KEY,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL CHECK (ends_on >= starts_on),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','review','finalized','paid')),
  finalized_by    INT REFERENCES staff(id) ON DELETE SET NULL,
  finalized_at    TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (starts_on)
);

COMMENT ON TABLE pay_periods IS
  'Payroll batching. Closes time_punches in a window from edits once status>=finalized.';

-- ─── 6. time_off_requests ──────────────────────────────────────────────────
-- Vacation / sick / personal. When status='approved', shift materialization
-- SKIPS this window so the calendar shows the gap explicitly.

CREATE TABLE IF NOT EXISTS time_off_requests (
  id              BIGSERIAL PRIMARY KEY,
  staff_id        INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  request_type    TEXT NOT NULL DEFAULT 'vacation'
                  CHECK (request_type IN ('vacation','sick','personal','bereavement','unpaid','other')),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','denied','cancelled')),
  reason          TEXT,
  decided_by      INT REFERENCES staff(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decided_note    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_off_staff
  ON time_off_requests(staff_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_off_active
  ON time_off_requests(staff_id, starts_at, ends_at)
  WHERE status = 'approved';

COMMENT ON TABLE time_off_requests IS
  'Vacation/sick/personal. Approved requests block shift materialization in their window.';

-- ─── 7. staff.shifts_materialized_through ─────────────────────────────────
-- Per-staff bookmark — "we have generated shift rows from templates
-- through this date already, no need to redo work". Reads check this
-- column and materialize the gap on demand. Replaces the cron model.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS shifts_materialized_through DATE;

-- ============================================================================
-- BACKFILL — seed shift_templates from the existing
-- staff_weekly_schedule rows at default 9 AM – 5 PM PT.
-- ============================================================================

INSERT INTO shift_templates
  (staff_id, day_of_week, starts_at_minute, ends_at_minute, timezone, effective_from)
SELECT
  sws.staff_id,
  sws.day_of_week,
  540,    -- 9 * 60
  1020,   -- 17 * 60
  'America/Los_Angeles',
  CURRENT_DATE
FROM staff_weekly_schedule sws
WHERE sws.is_scheduled = true
  AND NOT EXISTS (
    SELECT 1 FROM shift_templates st
    WHERE st.staff_id = sws.staff_id
      AND st.day_of_week = sws.day_of_week
      AND st.effective_to IS NULL
  );

-- ============================================================================
-- materialize_shifts — function used by the read path to generate concrete
-- shift rows for a staff over a date range from their templates. Honors:
--   • staff_schedule_overrides (single-day off/on flag)
--   • staff_availability_rules (weekday allowed/blocked)
--   • approved time_off_requests
--   • already-existing shifts for the same (staff, date) — no duplicates
--
-- Safe to call repeatedly. Updates staff.shifts_materialized_through.
-- ============================================================================

CREATE OR REPLACE FUNCTION materialize_shifts(
  p_staff_id INT,
  p_from DATE,
  p_to   DATE
) RETURNS INT AS $$
DECLARE
  v_created INT := 0;
  v_day DATE := p_from;
  v_dow INT;
  v_template shift_templates%ROWTYPE;
  v_starts_at TIMESTAMPTZ;
  v_ends_at   TIMESTAMPTZ;
  v_override_off BOOLEAN;
  v_blocked_by_rule BOOLEAN;
  v_blocked_by_time_off BOOLEAN;
BEGIN
  WHILE v_day <= p_to LOOP
    v_dow := EXTRACT(DOW FROM v_day);  -- 0=Sun..6=Sat

    -- Find any active template for (staff, weekday) on this date
    SELECT * INTO v_template
      FROM shift_templates
     WHERE staff_id = p_staff_id
       AND day_of_week = v_dow
       AND effective_from <= v_day
       AND (effective_to IS NULL OR effective_to >= v_day)
     ORDER BY effective_from DESC
     LIMIT 1;

    IF FOUND THEN
      -- Compute the absolute UTC window from minute-of-day in the template's tz
      v_starts_at := (v_day::text || ' 00:00')::timestamp
                     AT TIME ZONE v_template.timezone
                     + (v_template.starts_at_minute || ' minutes')::interval;
      v_ends_at   := (v_day::text || ' 00:00')::timestamp
                     AT TIME ZONE v_template.timezone
                     + (v_template.ends_at_minute || ' minutes')::interval;

      -- Schedule overrides (admin tapped "off" on this date)
      SELECT NOT COALESCE(sso.is_scheduled, true)
        INTO v_override_off
        FROM staff_schedule_overrides sso
       WHERE sso.staff_id = p_staff_id
         AND sso.schedule_date = v_day;
      v_override_off := COALESCE(v_override_off, false);

      -- Weekday-blocked availability rule covering this date
      SELECT TRUE INTO v_blocked_by_rule
        FROM staff_availability_rules sar
       WHERE sar.staff_id = p_staff_id
         AND sar.rule_type = 'weekday_allowed'
         AND sar.day_of_week = v_dow
         AND sar.is_allowed = false
         AND sar.deleted_at IS NULL
         AND (sar.effective_start_date IS NULL OR sar.effective_start_date <= v_day)
         AND (sar.effective_end_date   IS NULL OR sar.effective_end_date   >= v_day)
       LIMIT 1;
      v_blocked_by_rule := COALESCE(v_blocked_by_rule, false);

      -- Approved time-off covering this date
      SELECT TRUE INTO v_blocked_by_time_off
        FROM time_off_requests tor
       WHERE tor.staff_id = p_staff_id
         AND tor.status = 'approved'
         AND tor.starts_at <= v_ends_at
         AND tor.ends_at   >= v_starts_at
       LIMIT 1;
      v_blocked_by_time_off := COALESCE(v_blocked_by_time_off, false);

      -- Create shift only if not blocked and not already present
      IF NOT v_override_off
         AND NOT v_blocked_by_rule
         AND NOT v_blocked_by_time_off
         AND NOT EXISTS (
           SELECT 1 FROM shifts s
            WHERE s.staff_id = p_staff_id
              AND s.starts_at::date = v_day
              AND s.status NOT IN ('cancelled', 'missed')
         )
      THEN
        INSERT INTO shifts (staff_id, starts_at, ends_at, status, template_id)
        VALUES (p_staff_id, v_starts_at, v_ends_at, 'planned', v_template.id);
        v_created := v_created + 1;
      END IF;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  -- Bookmark the materialization horizon for this staff
  UPDATE staff
     SET shifts_materialized_through = GREATEST(COALESCE(shifts_materialized_through, p_to), p_to)
   WHERE id = p_staff_id;

  RETURN v_created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION materialize_shifts IS
  'Generates concrete shifts rows for one staff over [p_from, p_to] from their templates, honoring overrides/availability rules/time-off. Idempotent. Updates staff.shifts_materialized_through.';

-- Seed the next 14 days for every active staff so the calendar paints
-- something on day one of the rollout.
DO $$
DECLARE
  v_staff_id INT;
BEGIN
  FOR v_staff_id IN SELECT id FROM staff WHERE COALESCE(active, true) = true LOOP
    PERFORM materialize_shifts(v_staff_id, CURRENT_DATE, CURRENT_DATE + 14);
  END LOOP;
END $$;

COMMIT;
