/**
 * Per-staff station assignment queries (primary + secondary).
 *
 * Backs:
 *   - the admin Stations card (GET/PUT /api/admin/staff/[id]/stations)
 *   - the header goal chip's self endpoint (GET /api/staff-goals/me)
 *
 * Daily targets still come from `staff_goals.daily_goal`; this module only
 * decides WHICH stations a staffer sees. Staff with no `staff_stations` rows
 * fall back to the employee_id-prefix derived station (single, no switch) so
 * existing users keep working before any admin assignment is made.
 */

import pool from '@/lib/db';

export const VALID_STATIONS = ['TECH', 'PACK', 'UNBOX', 'SALES', 'FBA'] as const;
export type StationKey = (typeof VALID_STATIONS)[number];

export function isStation(v: unknown): v is StationKey {
  return typeof v === 'string' && (VALID_STATIONS as readonly string[]).includes(v.toUpperCase());
}
export function asStation(v: unknown): StationKey | null {
  return isStation(v) ? (String(v).toUpperCase() as StationKey) : null;
}

const SCAN_ACTIVITY_TYPES = ['TRACKING_SCANNED', 'FNSKU_SCANNED', 'PACK_SCAN', 'PACK_COMPLETED', 'FBA_READY'];

export interface StaffStationRow {
  station: StationKey;
  is_primary: boolean;
}

/** Raw assignment rows for one staff (primary first). Empty if none assigned. */
export async function getStaffStations(staffId: number): Promise<StaffStationRow[]> {
  const r = await pool.query(
    `SELECT station, is_primary
       FROM staff_stations
      WHERE staff_id = $1
      ORDER BY is_primary DESC, station ASC`,
    [staffId],
  );
  return r.rows.map((row) => ({ station: row.station as StationKey, is_primary: Boolean(row.is_primary) }));
}

/**
 * Staff ids whose PRIMARY station is TECH — the recipients for tech-station
 * inbox notifications (unboxed returns awaiting test, orders ready to ship).
 * Fan-out target for the publishers in src/lib/realtime/publish.ts.
 *
 * Org-scoped: `staff_stations` has no `organization_id` column, so we JOIN
 * `staff` and filter on its org — otherwise a second tenant's techs would be
 * enumerated into this org's fan-out.
 */
export async function getPrimaryTechStaffIds(orgId: string): Promise<number[]> {
  const r = await pool.query(
    `SELECT ss.staff_id
       FROM staff_stations ss
       JOIN staff s ON s.id = ss.staff_id
      WHERE ss.station = 'TECH' AND ss.is_primary = true
        AND s.organization_id = $1`,
    [orgId],
  );
  return r.rows
    .map((row) => Number(row.staff_id))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** True when this staffer's primary station is TECH (gates the tech-queue inbox feed). */
export async function isPrimaryTechStaff(staffId: number): Promise<boolean> {
  const stations = await getStaffStations(staffId);
  return stations.some((s) => s.station === 'TECH' && s.is_primary);
}

/** Derive the fallback station from the employee_id prefix (same rule as /api/staff-goals). */
async function deriveDefaultStation(staffId: number): Promise<StationKey> {
  const r = await pool.query(
    `SELECT CASE
              WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
              WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
              WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
              WHEN UPPER(employee_id) LIKE 'FBA%' THEN 'FBA'
              ELSE 'TECH'
            END AS station
       FROM staff WHERE id = $1 LIMIT 1`,
    [staffId],
  );
  return (r.rows[0]?.station as StationKey) ?? 'TECH';
}

export interface MyStationGoal {
  station: StationKey;
  is_primary: boolean;
  daily_goal: number;
  today_count: number;
}

/**
 * The logged-in staffer's station goals with live, deduped today counts.
 *
 * Returns the assigned stations (primary first). When the staffer has no
 * assignments yet, returns a single derived station marked primary — so the
 * chip shows one goal with no Switch control.
 */
export async function getMyStationGoals(staffId: number): Promise<MyStationGoal[]> {
  let assigned = await getStaffStations(staffId);
  if (assigned.length === 0) {
    const fallback = await deriveDefaultStation(staffId);
    assigned = [{ station: fallback, is_primary: true }];
  }
  const stations = assigned.map((a) => a.station);

  // Daily targets per station (default 50 where no staff_goals row exists).
  const goalsRes = await pool.query(
    `SELECT station, daily_goal
       FROM staff_goals
      WHERE staff_id = $1 AND station = ANY($2::text[])`,
    [staffId, stations],
  );
  const goalByStation = new Map<string, number>();
  for (const row of goalsRes.rows) {
    const g = Number(row.daily_goal);
    goalByStation.set(String(row.station), Number.isFinite(g) && g > 0 ? g : 50);
  }

  // Live deduped scan counts per station for today (PST), this staffer only.
  const countsRes = await pool.query(
    `SELECT station,
            COUNT(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int AS today_count
       FROM station_activity_logs
      WHERE staff_id = $1
        AND activity_type = ANY($2::text[])
        AND (timezone('America/Los_Angeles', created_at))::date
          = (timezone('America/Los_Angeles', now()))::date
      GROUP BY station`,
    [staffId, SCAN_ACTIVITY_TYPES],
  );
  const countByStation = new Map<string, number>();
  for (const row of countsRes.rows) {
    countByStation.set(String(row.station), Number(row.today_count) || 0);
  }

  return assigned.map((a) => ({
    station: a.station,
    is_primary: a.is_primary,
    daily_goal: goalByStation.get(a.station) ?? 50,
    today_count: countByStation.get(a.station) ?? 0,
  }));
}

/**
 * Replace a staffer's station set. `primary` is the single locked station (or
 * null to clear all assignments and fall back to the derived default).
 * `secondary` are the switchable extras; the primary is removed from that list
 * automatically. Runs in one transaction.
 */
export async function setStaffStations(
  staffId: number,
  primary: StationKey | null,
  secondary: StationKey[],
  assignedBy: number | null,
): Promise<{ primary: StationKey | null; secondary: StationKey[] }> {
  // Normalize: dedupe secondaries, drop the primary if it slipped in.
  const secSet = new Set<StationKey>();
  for (const s of secondary) {
    const st = asStation(s);
    if (st && st !== primary) secSet.add(st);
  }
  const secondaries = Array.from(secSet);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM staff_stations WHERE staff_id = $1`, [staffId]);

    const rows: Array<[StationKey, boolean]> = [];
    if (primary) rows.push([primary, true]);
    for (const s of secondaries) rows.push([s, false]);

    if (rows.length > 0) {
      const values = rows
        .map((_r, i) => `($1, $${i * 2 + 3}, $${i * 2 + 4}, NOW(), $2)`)
        .join(', ');
      const params: unknown[] = [staffId, assignedBy];
      for (const [station, isPrimary] of rows) {
        params.push(station, isPrimary);
      }
      await client.query(
        `INSERT INTO staff_stations (staff_id, station, is_primary, assigned_at, assigned_by)
         VALUES ${values}`,
        params,
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { primary, secondary: secondaries };
}
