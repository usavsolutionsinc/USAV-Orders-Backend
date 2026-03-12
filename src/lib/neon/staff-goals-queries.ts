import pool from '../db';

export interface StaffGoal {
  id: number;
  staff_id: number;
  daily_goal: number;
  updated_at: string | null;
}

export interface StaffGoalWithStats extends StaffGoal {
  staff_name: string;
  today_count: number;
  week_count: number;
  avg_daily_last_7d: number;
}

/**
 * Get all staff goals with live today/week counts joined from tech_serial_numbers
 */
export async function getAllStaffGoalsWithStats(): Promise<StaffGoalWithStats[]> {
  const result = await pool.query(
    `WITH today_counts AS (
      SELECT tested_by AS staff_id, COUNT(*) AS today_count
      FROM tech_serial_numbers
      WHERE created_at::date = CURRENT_DATE
      GROUP BY tested_by
    ),
    week_counts AS (
      SELECT tested_by AS staff_id, COUNT(*) AS week_count
      FROM tech_serial_numbers
      WHERE created_at >= date_trunc('week', NOW())
      GROUP BY tested_by
    ),
    last7_counts AS (
      SELECT tested_by AS staff_id,
             COUNT(*) / 7.0 AS avg_daily_last_7d
      FROM tech_serial_numbers
      WHERE created_at >= (NOW() - INTERVAL '7 days')
      GROUP BY tested_by
    )
    SELECT
      sg.id,
      sg.staff_id,
      sg.daily_goal,
      sg.updated_at,
      s.name AS staff_name,
      COALESCE(tc.today_count, 0)::int AS today_count,
      COALESCE(wc.week_count, 0)::int AS week_count,
      ROUND(COALESCE(l7.avg_daily_last_7d, 0), 1)::float AS avg_daily_last_7d
    FROM staff_goals sg
    JOIN staff s ON sg.staff_id = s.id
    LEFT JOIN today_counts tc ON tc.staff_id = sg.staff_id
    LEFT JOIN week_counts wc ON wc.staff_id = sg.staff_id
    LEFT JOIN last7_counts l7 ON l7.staff_id = sg.staff_id
    WHERE s.active = true
    ORDER BY sg.staff_id ASC`,
  );
  return result.rows;
}

/**
 * Get a single staff member's daily goal
 */
export async function getGoalByStaffId(staffId: number): Promise<StaffGoal | null> {
  const result = await pool.query(
    'SELECT * FROM staff_goals WHERE staff_id = $1',
    [staffId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get daily_goal value for a staff member (returns default 50 if not set)
 */
export async function getDailyGoal(staffId: number): Promise<number> {
  const result = await pool.query(
    'SELECT daily_goal FROM staff_goals WHERE staff_id = $1',
    [staffId],
  );
  return result.rows[0]?.daily_goal ?? 50;
}

/**
 * Upsert a staff goal
 */
export async function upsertStaffGoal(staffId: number, dailyGoal: number): Promise<StaffGoal> {
  const result = await pool.query(
    `INSERT INTO staff_goals (staff_id, daily_goal, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (staff_id)
     DO UPDATE SET daily_goal = EXCLUDED.daily_goal, updated_at = NOW()
     RETURNING *`,
    [staffId, dailyGoal],
  );
  return result.rows[0];
}

/**
 * Delete a staff goal
 */
export async function deleteStaffGoal(staffId: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM staff_goals WHERE staff_id = $1', [staffId]);
  return (result.rowCount ?? 0) > 0;
}
