import { getCurrentPSTDateKey } from '@/utils/date';

export function getWeekRangeForOffset(weekOffset: number, anchorDateKey?: string) {
  const baseDateKey = anchorDateKey || getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = baseDateKey.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday - (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return {
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}

const fmtDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Calendar-month range for an offset (0 = this month, 1 = last month, …),
 * first day → last day, in the PST-anchored local frame used by the week range.
 * Powers the "This month / Last month" presets in the date picker.
 */
export function getMonthRangeForOffset(monthOffset: number, anchorDateKey?: string) {
  const baseDateKey = anchorDateKey || getCurrentPSTDateKey();
  const [pstYear, pstMonth] = baseDateKey.split('-').map(Number);
  const first = new Date(pstYear, (pstMonth || 1) - 1 - monthOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { startStr: fmtDateKey(first), endStr: fmtDateKey(last) };
}

/** Monday of the ISO week containing `dateKey` (local frame). */
function mondayOf(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1);
  const day = dt.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  dt.setDate(dt.getDate() - daysFromMonday);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/**
 * Canonical Mon–Sun week buckets covering [startKey, endKey] inclusive. Each
 * bucket is a STABLE cache unit shared across every range that overlaps it, so
 * any date range is composed from already-fetched weeks — only never-seen weeks
 * hit the network. (Guarded to ≤260 weeks so a bad range can't loop forever.)
 */
export function getWeekBucketsForRange(
  startKey: string,
  endKey: string,
): { weekStart: string; weekEnd: string }[] {
  if (!startKey || !endKey) return [];
  const lastMon = mondayOf(endKey);
  const out: { weekStart: string; weekEnd: string }[] = [];
  const cur = mondayOf(startKey);
  for (let guard = 0; cur <= lastMon && guard < 260; guard++) {
    const sun = new Date(cur);
    sun.setDate(cur.getDate() + 6);
    out.push({ weekStart: fmtDateKey(cur), weekEnd: fmtDateKey(sun) });
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

/** Monday (YYYY-MM-DD) of the current PST week — the immutability boundary. */
function getCurrentWeekStartKey(): string {
  return fmtDateKey(mondayOf(getCurrentPSTDateKey()));
}

/** A week bucket is immutable once it starts strictly before the current week. */
export function isPastWeekStart(weekStartKey: string): boolean {
  return weekStartKey < getCurrentWeekStartKey();
}

/**
 * The current week + the previous `count - 1` weeks as Mon–Sun buckets (newest
 * first). Used to warm the cache on idle so the common period presets (this/last
 * week, this/last month) resolve instantly instead of cold-fetching on click.
 */
export function getRecentWeekBuckets(count: number): { weekStart: string; weekEnd: string }[] {
  const cur = mondayOf(getCurrentPSTDateKey());
  const out: { weekStart: string; weekEnd: string }[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const mon = new Date(cur);
    mon.setDate(cur.getDate() - i * 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    out.push({ weekStart: fmtDateKey(mon), weekEnd: fmtDateKey(sun) });
  }
  return out;
}
