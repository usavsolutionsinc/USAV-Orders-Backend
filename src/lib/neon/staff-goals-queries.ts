import pool from '../db';

export interface StaffGoal {
  id: number;
  staff_id: number;
  station: string;
  daily_goal: number;
  updated_at: string | null;
}

export interface StaffGoalWithStats {
  staff_id: number;
  staff_name: string;
  employee_id: string | null;
  station: string;
  daily_goal: number;
  today_count: number;
  week_count: number;
  avg_daily_last_7d: number;
}

/**
 * Get all staff goals with live today/week counts from station_activity_logs.
 * Returns all active staff (techs + packers), not just technicians.
 */
export async function getAllStaffGoalsWithStats(): Promise<StaffGoalWithStats[]> {
  const result = await pool.query(
    `WITH derived_station AS (
      SELECT id,
        CASE
          WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
          WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
          WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
          ELSE 'TECH'
        END AS default_station
      FROM staff
    ),
    today_counts AS (
      SELECT staff_id, station, COUNT(*)::int AS today_count
      FROM station_activity_logs
      WHERE staff_id IS NOT NULL
        AND (timezone('America/Los_Angeles', created_at))::date
          = (timezone('America/Los_Angeles', now()))::date
      GROUP BY staff_id, station
    ),
    week_counts AS (
      SELECT staff_id, station, COUNT(*)::int AS week_count
      FROM station_activity_logs
      WHERE staff_id IS NOT NULL
        AND (timezone('America/Los_Angeles', created_at))::date
          >= (timezone('America/Los_Angeles', now()))::date - INTERVAL '6 days'
      GROUP BY staff_id, station
    ),
    last7_counts AS (
      SELECT staff_id, station,
             COUNT(*) / 7.0 AS avg_daily_last_7d
      FROM station_activity_logs
      WHERE staff_id IS NOT NULL
        AND timezone('America/Los_Angeles', created_at)
          >= timezone('America/Los_Angeles', now()) - INTERVAL '7 days'
      GROUP BY staff_id, station
    )
    SELECT
      s.id AS staff_id,
      s.name AS staff_name,
      s.employee_id,
      COALESCE(sg.station, ds.default_station) AS station,
      COALESCE(sg.daily_goal, 50) AS daily_goal,
      COALESCE(tc.today_count, 0)::int AS today_count,
      COALESCE(wc.week_count, 0)::int AS week_count,
      ROUND(COALESCE(l7.avg_daily_last_7d, 0), 1)::float AS avg_daily_last_7d
    FROM staff s
    JOIN derived_station ds ON ds.id = s.id
    LEFT JOIN staff_goals sg ON sg.staff_id = s.id
    LEFT JOIN today_counts tc ON tc.staff_id = s.id AND tc.station = COALESCE(sg.station, ds.default_station)
    LEFT JOIN week_counts wc ON wc.staff_id = s.id AND wc.station = COALESCE(sg.station, ds.default_station)
    LEFT JOIN last7_counts l7 ON l7.staff_id = s.id AND l7.station = COALESCE(sg.station, ds.default_station)
    WHERE s.active = true
    ORDER BY s.name ASC, sg.station ASC`,
  );
  return result.rows;
}

/**
 * Get a single staff member's goal for a specific station.
 */
export async function getGoalByStaffId(staffId: number, station?: string): Promise<StaffGoal | null> {
  if (station) {
    const result = await pool.query(
      'SELECT * FROM staff_goals WHERE staff_id = $1 AND station = $2',
      [staffId, station],
    );
    return result.rows[0] ?? null;
  }
  const result = await pool.query(
    'SELECT * FROM staff_goals WHERE staff_id = $1 ORDER BY station LIMIT 1',
    [staffId],
  );
  return result.rows[0] ?? null;
}

/**
 * Get daily_goal value for a staff member + station (returns default 50 if not set).
 */
export async function getDailyGoal(staffId: number, station: string = 'TECH'): Promise<number> {
  const result = await pool.query(
    'SELECT daily_goal FROM staff_goals WHERE staff_id = $1 AND station = $2',
    [staffId, station],
  );
  return result.rows[0]?.daily_goal ?? 50;
}

/**
 * Upsert a staff goal for a specific station.
 */
export async function upsertStaffGoal(staffId: number, dailyGoal: number, station: string = 'TECH'): Promise<StaffGoal> {
  const result = await pool.query(
    `INSERT INTO staff_goals (staff_id, daily_goal, station, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (staff_id, station)
     DO UPDATE SET daily_goal = EXCLUDED.daily_goal, updated_at = NOW()
     RETURNING *`,
    [staffId, dailyGoal, station],
  );
  return result.rows[0];
}

/**
 * Delete a staff goal for a specific station.
 */
export async function deleteStaffGoal(staffId: number, station?: string): Promise<boolean> {
  if (station) {
    const result = await pool.query('DELETE FROM staff_goals WHERE staff_id = $1 AND station = $2', [staffId, station]);
    return (result.rowCount ?? 0) > 0;
  }
  const result = await pool.query('DELETE FROM staff_goals WHERE staff_id = $1', [staffId]);
  return (result.rowCount ?? 0) > 0;
}
