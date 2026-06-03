-- ============================================================================
-- 2026-06-02: Per-staff station assignments (primary + secondary)
-- ============================================================================
-- Admins assign each staff member ONE primary station (always shown in the
-- header goal chip, locked) plus any number of secondary stations (the chip's
-- "Switch" control only appears when a staffer has at least one secondary, and
-- it only offers the assigned stations — never all five).
--
-- Station values: TECH, PACK, UNBOX, SALES, FBA — same set used by staff_goals
-- and validated by /api/staff-goals. Daily targets still live in staff_goals
-- (daily_goal); this table only governs WHICH stations a staffer can see/switch
-- between. Staff with no rows here fall back to the employee_id-prefix derived
-- station (single, no switch), so existing users keep working unchanged.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS staff_stations (
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  station     VARCHAR(20) NOT NULL,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  PRIMARY KEY (staff_id, station),
  CONSTRAINT staff_stations_station_chk
    CHECK (station IN ('TECH', 'PACK', 'UNBOX', 'SALES', 'FBA'))
);

-- At most one primary station per staff.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_primary_station
  ON staff_stations (staff_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_staff_stations_staff ON staff_stations(staff_id);

COMMENT ON TABLE staff_stations IS 'Per-staff station assignments. Exactly one is_primary row per staff (enforced by uniq_staff_primary_station); the rest are secondary stations the header goal chip can switch between.';
COMMENT ON COLUMN staff_stations.is_primary IS 'The always-shown, locked station for the header goal chip. Secondary rows (is_primary=false) only appear behind the Switch control.';

COMMIT;
