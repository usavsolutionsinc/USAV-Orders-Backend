-- staff_goals: add station column so techs and packers can have separate goals
-- Existing rows get station = 'TECH' (all current goals are for technicians)

ALTER TABLE staff_goals DROP CONSTRAINT IF EXISTS staff_goals_staff_id_key;

ALTER TABLE staff_goals
  ADD COLUMN IF NOT EXISTS station VARCHAR(10) NOT NULL DEFAULT 'TECH';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_goals_staff_station_uq'
  ) THEN
    ALTER TABLE staff_goals ADD CONSTRAINT staff_goals_staff_station_uq UNIQUE (staff_id, station);
  END IF;
END $$;

-- Nightly snapshots for trend tracking
CREATE TABLE IF NOT EXISTS staff_goal_history (
  id          SERIAL PRIMARY KEY,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  station     VARCHAR(10) NOT NULL DEFAULT 'TECH',
  goal        INTEGER NOT NULL,
  actual      INTEGER NOT NULL DEFAULT 0,
  logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_goal_history_uniq
  ON staff_goal_history (staff_id, station, logged_date);
