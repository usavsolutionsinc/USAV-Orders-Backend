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
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

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
export async function getStaffStations(staffId: number, orgId?: OrgId): Promise<StaffStationRow[]> {
  // `staff_stations` has no organization_id column → scope via its `staff` parent.
  const r = orgId
    ? await tenantQuery(
        orgId,
        `SELECT ss.station, ss.is_primary
           FROM staff_stations ss
           JOIN staff s ON s.id = ss.staff_id
          WHERE ss.staff_id = $1
            AND s.organization_id = $2
          ORDER BY ss.is_primary DESC, ss.station ASC`,
        [staffId, orgId],
      )
    : await pool.query(
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
  // orgId is always present here → route through the tenant executor (RLS-subject)
  // while keeping the explicit parent-org JOIN predicate. Signature unchanged.
  const r = await tenantQuery(
    orgId as OrgId,
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
export async function isPrimaryTechStaff(staffId: number, orgId?: OrgId): Promise<boolean> {
  const stations = await getStaffStations(staffId, orgId);
  return stations.some((s) => s.station === 'TECH' && s.is_primary);
}

/** Derive the fallback station from the employee_id prefix (same rule as /api/staff-goals). */
async function deriveDefaultStation(staffId: number, orgId?: OrgId): Promise<StationKey> {
  const sql = `SELECT CASE
              WHEN UPPER(employee_id) LIKE 'PACK%' THEN 'PACK'
              WHEN UPPER(employee_id) LIKE 'UNBOX%' THEN 'UNBOX'
              WHEN UPPER(employee_id) LIKE 'SALES%' THEN 'SALES'
              WHEN UPPER(employee_id) LIKE 'FBA%' THEN 'FBA'
              ELSE 'TECH'
            END AS station
       FROM staff WHERE id = $1`;
  // `staff` HAS organization_id → add the explicit predicate when scoped.
  const r = orgId
    ? await tenantQuery(orgId, `${sql} AND organization_id = $2 LIMIT 1`, [staffId, orgId])
    : await pool.query(`${sql} LIMIT 1`, [staffId]);
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
export async function getMyStationGoals(staffId: number, orgId?: OrgId): Promise<MyStationGoal[]> {
  let assigned = await getStaffStations(staffId, orgId);
  if (assigned.length === 0) {
    const fallback = await deriveDefaultStation(staffId, orgId);
    assigned = [{ station: fallback, is_primary: true }];
  }
  const stations = assigned.map((a) => a.station);

  // Daily targets per station (default 50 where no staff_goals row exists).
  // `staff_goals` has no organization_id column → scope via its `staff` parent.
  const goalsRes = orgId
    ? await tenantQuery(
        orgId,
        `SELECT sg.station, sg.daily_goal
           FROM staff_goals sg
           JOIN staff s ON s.id = sg.staff_id
          WHERE sg.staff_id = $1 AND sg.station = ANY($2::text[])
            AND s.organization_id = $3`,
        [staffId, stations, orgId],
      )
    : await pool.query(
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
  // `station_activity_logs` HAS organization_id → add the explicit predicate.
  const countsRes = orgId
    ? await tenantQuery(
        orgId,
        `SELECT station,
                COUNT(DISTINCT COALESCE(shipment_id::text, scan_ref, id::text))::int AS today_count
           FROM station_activity_logs
          WHERE staff_id = $1
            AND activity_type = ANY($2::text[])
            AND organization_id = $3
            AND (timezone('America/Los_Angeles', created_at))::date
              = (timezone('America/Los_Angeles', now()))::date
          GROUP BY station`,
        [staffId, SCAN_ACTIVITY_TYPES, orgId],
      )
    : await pool.query(
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
  orgId?: OrgId,
): Promise<{ primary: StationKey | null; secondary: StationKey[] }> {
  // Normalize: dedupe secondaries, drop the primary if it slipped in.
  const secSet = new Set<StationKey>();
  for (const s of secondary) {
    const st = asStation(s);
    if (st && st !== primary) secSet.add(st);
  }
  const secondaries = Array.from(secSet);

  const rows: Array<[StationKey, boolean]> = [];
  if (primary) rows.push([primary, true]);
  for (const s of secondaries) rows.push([s, false]);

  if (orgId) {
    // Tenant-scoped path. `staff_stations` has no organization_id column, so we
    // gate both the DELETE and the INSERT on the `staff` parent belonging to
    // this org (cross-tenant staffId becomes a no-op → org-ownership 404 at the
    // route layer, never a wrong-tenant mutation).
    await withTenantTransaction(orgId, async (client) => {
      await client.query(
        `DELETE FROM staff_stations
          WHERE staff_id = $1
            AND EXISTS (SELECT 1 FROM staff s WHERE s.id = $1 AND s.organization_id = $2)`,
        [staffId, orgId],
      );

      if (rows.length > 0) {
        // INSERT ... SELECT so each row is only written when the parent staff
        // belongs to this org (derives the guard from the parent, no blind write).
        // Cast the first VALUES row's columns so the derived table has concrete
        // types (nullable `assigned_by` would otherwise be ambiguous).
        const values = rows
          .map((_r, i) =>
            i === 0
              ? `($1::int, $3::text, $4::boolean, NOW(), $2::int)`
              : `($1, $${i * 2 + 3}, $${i * 2 + 4}, NOW(), $2)`,
          )
          .join(', ');
        const params: unknown[] = [staffId, assignedBy];
        for (const [station, isPrimary] of rows) {
          params.push(station, isPrimary);
        }
        await client.query(
          `INSERT INTO staff_stations (staff_id, station, is_primary, assigned_at, assigned_by)
           SELECT v.staff_id, v.station, v.is_primary, v.assigned_at, v.assigned_by
             FROM (VALUES ${values}) AS v(staff_id, station, is_primary, assigned_at, assigned_by)
            WHERE EXISTS (SELECT 1 FROM staff s WHERE s.id = $1 AND s.organization_id = $2)`,
          params,
        );
      }
    });
    return { primary, secondary: secondaries };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM staff_stations WHERE staff_id = $1`, [staffId]);

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
