/**
 * Labor throughput — the headline ROI metric: units processed per labor-hour.
 *
 * "How many units did the shop move per paid hour on the clock?" — the single
 * number that proves a productivity lift in week one. Org-scoped and tenant-safe:
 * every read runs through `tenantQuery(orgId, …)` (GUC-scoped tenant connection),
 * and the two spines are joined to the tenant's own rows only.
 *
 *   unitsProcessed — distinct serial units that ADVANCED A STAGE in the window,
 *                    from inventory_events. "Advanced a stage" = an event that
 *                    set a new next_status distinct from prev_status (so pure
 *                    NOTE/annotation rows, which carry no status diff, never
 *                    inflate the count). Org-scoped on inventory_events.organization_id.
 *   laborHours     — Σ clocked hours from time_punches over the window:
 *                    (punched_out − punched_in) − break_minutes, per CLOSED punch.
 *                    time_punches has no organization_id, so it is org-scoped by
 *                    JOINing staff (which does) and filtering staff.organization_id.
 *   unitsPerLaborHour — unitsProcessed / laborHours, guarded against /0.
 *   perStaff       — the same split per worker (units they advanced, their clocked
 *                    hours, their units/hr) for the leaderboard.
 *
 * Collaborators are injected (defaulting to the real tenant-scoped impls) so the
 * pure compose/divide logic is unit-testable with in-memory fakes — the house
 * Deps pattern (see backend-patterns.md "Dependency injection", applyTransition).
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface StaffUnitsRow {
  staffId: number;
  staffName: string;
  unitsProcessed: number;
}

export interface StaffHoursRow {
  staffId: number;
  staffName: string;
  laborHours: number;
}

export interface PerStaffThroughput {
  staffId: number;
  staffName: string;
  unitsProcessed: number;
  laborHours: number;
  unitsPerLaborHour: number;
}

export interface LaborThroughputResult {
  unitsProcessed: number;
  laborHours: number;
  unitsPerLaborHour: number;
  perStaff: PerStaffThroughput[];
}

export interface LaborThroughputWindow {
  from: Date;
  to: Date;
}

/** Injectable, org-scoped data seams (real tenant-scoped impls by default; fakes in tests). */
export interface LaborThroughputDeps {
  /** Distinct serial units that advanced a stage in [from, to) for the org. */
  fetchTotalUnitsProcessed(orgId: OrgId, from: Date, to: Date): Promise<number>;
  /** Per-staff distinct units advanced in [from, to). */
  fetchUnitsByStaff(orgId: OrgId, from: Date, to: Date): Promise<StaffUnitsRow[]>;
  /** Per-staff clocked labor hours in [from, to). */
  fetchLaborHoursByStaff(orgId: OrgId, from: Date, to: Date): Promise<StaffHoursRow[]>;
}

/** Round to 2 dp for display-ready numbers (avoids 0.30000000004 noise). */
function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** Guarded ratio — 0 when there are no labor hours (never NaN/Infinity). */
function perHour(units: number, hours: number): number {
  return hours > 0 ? round2(units / hours) : 0;
}

const defaultDeps: LaborThroughputDeps = {
  async fetchTotalUnitsProcessed(orgId, from, to) {
    const { rows } = await tenantQuery<{ units: number | string }>(
      orgId,
      `SELECT COUNT(DISTINCT ie.serial_unit_id)::int AS units
         FROM inventory_events ie
        WHERE ie.organization_id = $1
          AND ie.serial_unit_id IS NOT NULL
          AND ie.occurred_at >= $2 AND ie.occurred_at < $3
          AND ie.next_status IS NOT NULL
          AND ie.next_status IS DISTINCT FROM ie.prev_status`,
      [orgId, from, to],
    );
    return Number(rows[0]?.units ?? 0);
  },

  async fetchUnitsByStaff(orgId, from, to) {
    const { rows } = await tenantQuery<{ staff_id: number; staff_name: string; units_processed: number | string }>(
      orgId,
      `SELECT ie.actor_staff_id AS staff_id,
              st.name           AS staff_name,
              COUNT(DISTINCT ie.serial_unit_id)::int AS units_processed
         FROM inventory_events ie
         JOIN staff st ON st.id = ie.actor_staff_id AND st.organization_id = $1
        WHERE ie.organization_id = $1
          AND ie.serial_unit_id IS NOT NULL
          AND ie.actor_staff_id IS NOT NULL
          AND ie.occurred_at >= $2 AND ie.occurred_at < $3
          AND ie.next_status IS NOT NULL
          AND ie.next_status IS DISTINCT FROM ie.prev_status
        GROUP BY ie.actor_staff_id, st.name`,
      [orgId, from, to],
    );
    return rows.map((r) => ({
      staffId: Number(r.staff_id),
      staffName: r.staff_name ?? 'Unknown',
      unitsProcessed: Number(r.units_processed ?? 0),
    }));
  },

  async fetchLaborHoursByStaff(orgId, from, to) {
    const { rows } = await tenantQuery<{ staff_id: number; staff_name: string; labor_hours: number | string }>(
      orgId,
      `SELECT tp.staff_id AS staff_id,
              st.name     AS staff_name,
              COALESCE(SUM(
                GREATEST(0,
                  EXTRACT(EPOCH FROM (tp.punched_out_at - tp.punched_in_at)) / 3600.0
                  - tp.break_minutes / 60.0
                )
              ), 0)::float8 AS labor_hours
         FROM time_punches tp
         JOIN staff st ON st.id = tp.staff_id AND st.organization_id = $1
        WHERE tp.punched_out_at IS NOT NULL
          AND tp.punched_in_at >= $2 AND tp.punched_in_at < $3
        GROUP BY tp.staff_id, st.name`,
      [orgId, from, to],
    );
    return rows.map((r) => ({
      staffId: Number(r.staff_id),
      staffName: r.staff_name ?? 'Unknown',
      laborHours: Number(r.labor_hours ?? 0),
    }));
  },
};

/**
 * Compute units-per-labor-hour for an org over [window.from, window.to).
 * Org-scoped (every dep query is tenant-scoped); divide-by-zero guarded.
 */
export async function computeLaborThroughput(
  orgId: OrgId,
  window: LaborThroughputWindow,
  deps: LaborThroughputDeps = defaultDeps,
): Promise<LaborThroughputResult> {
  const [unitsProcessed, unitsByStaff, hoursByStaff] = await Promise.all([
    deps.fetchTotalUnitsProcessed(orgId, window.from, window.to),
    deps.fetchUnitsByStaff(orgId, window.from, window.to),
    deps.fetchLaborHoursByStaff(orgId, window.from, window.to),
  ]);

  // Total labor hours = Σ per-staff hours (hours don't dedupe across workers).
  const laborHours = round2(hoursByStaff.reduce((sum, r) => sum + r.laborHours, 0));

  // Merge the two per-staff spines by staffId into one leaderboard row each.
  const byStaff = new Map<number, PerStaffThroughput>();
  for (const u of unitsByStaff) {
    byStaff.set(u.staffId, {
      staffId: u.staffId,
      staffName: u.staffName,
      unitsProcessed: u.unitsProcessed,
      laborHours: 0,
      unitsPerLaborHour: 0,
    });
  }
  for (const h of hoursByStaff) {
    const existing = byStaff.get(h.staffId);
    if (existing) {
      existing.laborHours = round2(h.laborHours);
      existing.staffName = existing.staffName || h.staffName;
    } else {
      byStaff.set(h.staffId, {
        staffId: h.staffId,
        staffName: h.staffName,
        unitsProcessed: 0,
        laborHours: round2(h.laborHours),
        unitsPerLaborHour: 0,
      });
    }
  }

  const perStaff = Array.from(byStaff.values())
    .map((r) => ({ ...r, unitsPerLaborHour: perHour(r.unitsProcessed, r.laborHours) }))
    .sort((a, b) => b.unitsProcessed - a.unitsProcessed || b.unitsPerLaborHour - a.unitsPerLaborHour);

  return {
    unitsProcessed,
    laborHours,
    unitsPerLaborHour: perHour(unitsProcessed, laborHours),
    perStaff,
  };
}
