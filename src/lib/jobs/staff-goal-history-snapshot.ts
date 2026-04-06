import { snapshotStaffGoalHistoryForDate } from '@/lib/neon/staff-goals-queries';

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

  const rows = await snapshotStaffGoalHistoryForDate(loggedDate);
  const uniqueStaffIds = new Set(rows.map((row) => row.staff_id));
  const stations = [...new Set(rows.map((row) => row.station))].sort();

  return {
    ok: true,
    loggedDate,
    snapshotRows: rows.length,
    staffCount: uniqueStaffIds.size,
    stations,
  };
}
