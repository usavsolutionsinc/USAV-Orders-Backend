import { snapshotStaffGoalHistoryForDate } from '@/lib/neon/staff-goals-queries';
import { listSweepOrgIds } from '@/lib/cron/for-each-org';

export interface StaffGoalHistorySnapshotPayload {
  loggedDate?: string;
}

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

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function runStaffGoalHistorySnapshotJob(
  payload: StaffGoalHistorySnapshotPayload = {},
) {
  const loggedDate = String(payload.loggedDate || getPacificDateStamp()).trim();
  if (!isIsoDate(loggedDate)) {
    throw new Error('loggedDate must be in YYYY-MM-DD format');
  }

  // Phase D: fan out per active org instead of one global snapshot pass. Each
  // org's snapshot runs through snapshotStaffGoalHistoryForDate(date, _, orgId),
  // which opens its OWN tenant-scoped tenantQuery (GUC set + explicit
  // staff/SAL org predicates), so a pass only writes that org's staff rows.
  // staff_goal_history is staff-scoped (no own org column) and keyed by
  // (staff_id, station, logged_date) — staff belong to exactly one org, so the
  // union of per-org passes is identical to the previous global pass, now
  // tenant-isolated. We use listSweepOrgIds (not forEachActiveOrg) because the
  // snapshot helper already manages its own per-org transaction; wrapping it in
  // another would just pin an idle connection. Per-org failures are isolated —
  // one bad tenant never aborts the sweep.
  const orgIds = await listSweepOrgIds();
  const uniqueStaffIds = new Set<number>();
  const stations = new Set<string>();
  let snapshotRows = 0;
  let orgsFailed = 0;
  const errors: Array<{ orgId: string; error: string }> = [];

  for (const orgId of orgIds) {
    try {
      const rows = await snapshotStaffGoalHistoryForDate(loggedDate, undefined, orgId);
      snapshotRows += rows.length;
      for (const row of rows) {
        uniqueStaffIds.add(row.staff_id);
        stations.add(row.station);
      }
    } catch (err) {
      orgsFailed += 1;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[staff-goals/history] org ${orgId} failed:`, error);
      errors.push({ orgId, error });
    }
  }

  return {
    ok: orgsFailed === 0,
    loggedDate,
    snapshotRows,
    staffCount: uniqueStaffIds.size,
    stations: [...stations].sort(),
    orgsSwept: orgIds.length,
    orgsFailed,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
