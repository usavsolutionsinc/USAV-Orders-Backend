import pool from '../db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

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

export interface StaffGoalHistoryRow {
  id: number;
  staff_id: number;
  station: string;
  goal: number;
  actual: number;
  logged_date: string;
  created_at: string;
}

type Queryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[] }>;
};

const STAFF_GOAL_ACTIVITY_TYPES = [
  'TRACKING_SCANNED',
  'FNSKU_SCANNED',
  'PACK_SCAN',
  'PACK_COMPLETED',
  'FBA_READY',
] as const;

function getPacificDateStamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to derive Pacific date stamp');
  }

  return `${year}-${month}-${day}`;
}

function buildStaffGoalHistorySnapshotQuery(loggedDate: string, filters?: { staffId?: number; station?: string; orgId?: OrgId }) {
  const params: any[] = [loggedDate];
  const goalConditions = ['s.active = true'];
  const actualConditions = [
    'sal.staff_id IS NOT NULL',
    `sal.activity_type = ANY($2::text[])`,
    "(timezone('America/Los_Angeles', sal.created_at))::date = $1::date",
  ];

  params.push([...STAFF_GOAL_ACTIVITY_TYPES]);

  let nextParam = 3;

  if (filters?.staffId) {
    goalConditions.push(`s.id = $${nextParam}`);
    actualConditions.push(`sal.staff_id = $${nextParam}`);
    params.push(filters.staffId);
    nextParam += 1;
  }

  if (filters?.station) {
    goalConditions.push(`COALESCE(sg.station, ds.default_station) = $${nextParam}`);
    actualConditions.push(`sal.station = $${nextParam}`);
    params.push(filters.station);
    nextParam += 1;
  }

  // Tenant scope: staff_goals/staff_goal_history have no own organization_id —
  // scope them via the parent staff row. station_activity_logs DOES carry its
  // own organization_id, so the actual-counts read gets an explicit predicate
  // for defense-in-depth (the RLS GUC is the backstop). When orgId is omitted
  // (cron-wide snapshot across all orgs) behavior is byte-identical to before.
  if (filters?.orgId) {
    goalConditions.push(`s.organization_id = $${nextParam}`);
    actualConditions.push(`sal.organization_id = $${nextParam}`);
    params.push(filters.orgId);
    nextParam += 1;
  }

  return {
    params,
    sql: `
      WITH derived_station AS (
        SELECT id,
          CASE
            WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
            WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
            WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
            ELSE 'TECH'
          END AS default_station
        FROM staff
      ),
      goal_rows AS (
        SELECT
          s.id AS staff_id,
          COALESCE(sg.station, ds.default_station) AS station,
          COALESCE(sg.daily_goal, 50)::int AS goal
        FROM staff s
        JOIN derived_station ds ON ds.id = s.id
        LEFT JOIN staff_goals sg ON sg.staff_id = s.id
        WHERE ${goalConditions.join(' AND ')}
      ),
      actual_counts AS (
        SELECT
          sal.staff_id,
          sal.station,
          COUNT(DISTINCT COALESCE(sal.shipment_id::text, sal.scan_ref, sal.id::text))::int AS actual
        FROM station_activity_logs sal
        WHERE ${actualConditions.join(' AND ')}
        GROUP BY sal.staff_id, sal.station
      )
      INSERT INTO staff_goal_history (staff_id, station, goal, actual, logged_date)
      SELECT
        gr.staff_id,
        gr.station,
        gr.goal,
        COALESCE(ac.actual, 0)::int AS actual,
        $1::date AS logged_date
      FROM goal_rows gr
      LEFT JOIN actual_counts ac
        ON ac.staff_id = gr.staff_id
       AND ac.station = gr.station
      ON CONFLICT (staff_id, station, logged_date)
      DO UPDATE SET
        goal = EXCLUDED.goal,
        actual = EXCLUDED.actual
      RETURNING *`,
  };
}

export async function snapshotStaffGoalHistoryForDate(
  loggedDate: string = getPacificDateStamp(),
  queryable: Queryable = pool,
  orgId?: OrgId,
): Promise<StaffGoalHistoryRow[]> {
  const { sql, params } = buildStaffGoalHistorySnapshotQuery(loggedDate, orgId ? { orgId } : undefined);
  if (orgId) {
    const result = await tenantQuery(orgId, sql, params);
    return result.rows as StaffGoalHistoryRow[];
  }
  const result = await queryable.query(sql, params);
  return result.rows;
}

export async function snapshotSingleStaffGoalHistory(
  staffId: number,
  station: string,
  loggedDate: string = getPacificDateStamp(),
  queryable: Queryable = pool,
  orgId?: OrgId,
): Promise<StaffGoalHistoryRow | null> {
  const { sql, params } = buildStaffGoalHistorySnapshotQuery(loggedDate, { staffId, station, ...(orgId ? { orgId } : {}) });
  const result = await queryable.query(sql, params);
  return result.rows[0] ?? null;
}

/**
 * Get all staff goals with live today/week counts from station_activity_logs.
 * Returns all active staff (techs + packers), not just technicians.
 */
export async function getAllStaffGoalsWithStats(orgId?: OrgId): Promise<StaffGoalWithStats[]> {
  // staff_goals has no own organization_id — scope via the parent staff row.
  // When orgId is omitted (transitional callers) behavior is byte-identical.
  const orgFilter = orgId ? 'AND s.organization_id = $1' : '';
  // station_activity_logs has its own organization_id — filter the count CTEs
  // explicitly (defense-in-depth on top of the tenantQuery GUC; the staff_id
  // join is already org-correct but an explicit predicate is FORCE-robust).
  const salOrgFilter = orgId ? 'AND organization_id = $1' : '';
  const sql =
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
    staff_primary_goal AS (
      SELECT DISTINCT ON (staff_id)
        staff_id, station, daily_goal
      FROM staff_goals
      ORDER BY staff_id, updated_at DESC NULLS LAST
    ),
    today_counts AS (
      SELECT staff_id, station,
        COUNT(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int AS today_count
      FROM station_activity_logs
      WHERE staff_id IS NOT NULL
        AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY')
        ${salOrgFilter}
        AND (timezone('America/Los_Angeles', created_at))::date
          = (timezone('America/Los_Angeles', now()))::date
      GROUP BY staff_id, station
    ),
    week_counts AS (
      SELECT staff_id, station,
        COUNT(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int AS week_count
      FROM station_activity_logs
      WHERE staff_id IS NOT NULL
        AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY')
        ${salOrgFilter}
        AND (timezone('America/Los_Angeles', created_at))::date
          >= (timezone('America/Los_Angeles', now()))::date - INTERVAL '6 days'
      GROUP BY staff_id, station
    ),
    last7_counts AS (
      SELECT staff_id, station,
             COUNT(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text)) / 7.0 AS avg_daily_last_7d
      FROM station_activity_logs
      WHERE staff_id IS NOT NULL
        AND activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY')
        ${salOrgFilter}
        AND timezone('America/Los_Angeles', created_at)
          >= timezone('America/Los_Angeles', now()) - INTERVAL '7 days'
      GROUP BY staff_id, station
    )
    SELECT
      s.id AS staff_id,
      s.name AS staff_name,
      s.employee_id,
      COALESCE(spg.station, ds.default_station) AS station,
      COALESCE(spg.daily_goal, 50) AS daily_goal,
      COALESCE(tc.today_count, 0)::int AS today_count,
      COALESCE(wc.week_count, 0)::int AS week_count,
      ROUND(COALESCE(l7.avg_daily_last_7d, 0), 1)::float AS avg_daily_last_7d
    FROM staff s
    JOIN derived_station ds ON ds.id = s.id
    LEFT JOIN staff_primary_goal spg ON spg.staff_id = s.id
    LEFT JOIN today_counts tc ON tc.staff_id = s.id AND tc.station = COALESCE(spg.station, ds.default_station)
    LEFT JOIN week_counts wc ON wc.staff_id = s.id AND wc.station = COALESCE(spg.station, ds.default_station)
    LEFT JOIN last7_counts l7 ON l7.staff_id = s.id AND l7.station = COALESCE(spg.station, ds.default_station)
    WHERE s.active = true
      ${orgFilter}
    ORDER BY s.name ASC`;
  const result = orgId
    ? await tenantQuery(orgId, sql, [orgId])
    : await pool.query(sql);
  return result.rows;
}

/**
 * Get a single staff member's goal for a specific station.
 */
export async function getGoalByStaffId(staffId: number, station?: string, orgId?: OrgId): Promise<StaffGoal | null> {
  // staff_goals has no own organization_id — scope via the parent staff row
  // with a subquery. Byte-identical when orgId is omitted.
  if (station) {
    if (orgId) {
      const result = await tenantQuery<StaffGoal>(
        orgId,
        `SELECT * FROM staff_goals
          WHERE staff_id = $1 AND station = $2
            AND staff_id IN (SELECT id FROM staff WHERE organization_id = $3)`,
        [staffId, station, orgId],
      );
      return result.rows[0] ?? null;
    }
    const result = await pool.query(
      'SELECT * FROM staff_goals WHERE staff_id = $1 AND station = $2',
      [staffId, station],
    );
    return result.rows[0] ?? null;
  }
  if (orgId) {
    const result = await tenantQuery<StaffGoal>(
      orgId,
      `SELECT * FROM staff_goals
        WHERE staff_id = $1
          AND staff_id IN (SELECT id FROM staff WHERE organization_id = $2)
        ORDER BY station LIMIT 1`,
      [staffId, orgId],
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
export async function getDailyGoal(staffId: number, station: string = 'TECH', orgId?: OrgId): Promise<number> {
  // staff_goals has no own organization_id — scope via the parent staff row.
  if (orgId) {
    const result = await tenantQuery(
      orgId,
      `SELECT daily_goal FROM staff_goals
        WHERE staff_id = $1 AND station = $2
          AND staff_id IN (SELECT id FROM staff WHERE organization_id = $3)`,
      [staffId, station, orgId],
    );
    return result.rows[0]?.daily_goal ?? 50;
  }
  const result = await pool.query(
    'SELECT daily_goal FROM staff_goals WHERE staff_id = $1 AND station = $2',
    [staffId, station],
  );
  return result.rows[0]?.daily_goal ?? 50;
}

/**
 * Upsert a staff goal for a specific station.
 */
export async function upsertStaffGoal(staffId: number, dailyGoal: number, station: string = 'TECH', orgId?: OrgId): Promise<StaffGoal> {
  // staff_goals has no own organization_id — scope the write via the parent
  // staff row so a goal can only be written for a staff member in this org.
  // Byte-identical when orgId is omitted.
  if (orgId) {
    const result = await tenantQuery<StaffGoal>(
      orgId,
      `INSERT INTO staff_goals (staff_id, daily_goal, station, updated_at)
       SELECT $1, $2, $3, NOW()
       WHERE EXISTS (SELECT 1 FROM staff WHERE id = $1 AND organization_id = $4)
       ON CONFLICT (staff_id, station)
       DO UPDATE SET daily_goal = EXCLUDED.daily_goal, updated_at = NOW()
       RETURNING *`,
      [staffId, dailyGoal, station, orgId],
    );
    return result.rows[0];
  }
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

export async function upsertStaffGoalWithHistory(
  staffId: number,
  dailyGoal: number,
  station: string = 'TECH',
  orgId?: OrgId,
): Promise<StaffGoal> {
  // Tenant-scoped path: staff_goals/staff_goal_history have no own
  // organization_id, so the write is scoped via the parent staff row. The
  // enclosing withTenantTransaction sets the org GUC and the SQL guards the
  // INSERT against staff in this org.
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const result = await client.query(
        `INSERT INTO staff_goals (staff_id, daily_goal, station, updated_at)
         SELECT $1, $2, $3, NOW()
         WHERE EXISTS (SELECT 1 FROM staff WHERE id = $1 AND organization_id = $4)
         ON CONFLICT (staff_id, station)
         DO UPDATE SET daily_goal = EXCLUDED.daily_goal, updated_at = NOW()
         RETURNING *`,
        [staffId, dailyGoal, station, orgId],
      );

      await snapshotSingleStaffGoalHistory(staffId, station, getPacificDateStamp(), client, orgId);

      return result.rows[0];
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO staff_goals (staff_id, daily_goal, station, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (staff_id, station)
       DO UPDATE SET daily_goal = EXCLUDED.daily_goal, updated_at = NOW()
       RETURNING *`,
      [staffId, dailyGoal, station],
    );

    await snapshotSingleStaffGoalHistory(staffId, station, getPacificDateStamp(), client);

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a staff goal for a specific station.
 */
export async function deleteStaffGoal(staffId: number, station?: string, orgId?: OrgId): Promise<boolean> {
  // staff_goals has no own organization_id — scope the delete via the parent
  // staff row. Byte-identical when orgId is omitted.
  if (station) {
    if (orgId) {
      const result = await tenantQuery(
        orgId,
        `DELETE FROM staff_goals
          WHERE staff_id = $1 AND station = $2
            AND staff_id IN (SELECT id FROM staff WHERE organization_id = $3)`,
        [staffId, station, orgId],
      );
      return (result.rowCount ?? 0) > 0;
    }
    const result = await pool.query('DELETE FROM staff_goals WHERE staff_id = $1 AND station = $2', [staffId, station]);
    return (result.rowCount ?? 0) > 0;
  }
  if (orgId) {
    const result = await tenantQuery(
      orgId,
      `DELETE FROM staff_goals
        WHERE staff_id = $1
          AND staff_id IN (SELECT id FROM staff WHERE organization_id = $2)`,
      [staffId, orgId],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const result = await pool.query('DELETE FROM staff_goals WHERE staff_id = $1', [staffId]);
  return (result.rowCount ?? 0) > 0;
}
