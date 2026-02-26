-- Store per-staff daily goals for dashboard progress and admin management
CREATE TABLE IF NOT EXISTS staff_goals (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL UNIQUE REFERENCES staff(id) ON DELETE CASCADE,
  daily_goal INTEGER NOT NULL DEFAULT 50 CHECK (daily_goal > 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_goals_staff_id ON staff_goals(staff_id);
