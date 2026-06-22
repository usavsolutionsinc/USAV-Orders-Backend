import type { WorkOrderRow } from '@/components/work-orders/types';

/**
 * Pure day-bucketing helpers for the scheduling calendar. Kept framework-free
 * so they can be unit-tested and reused by both the month grid and any future
 * week/agenda view.
 */

/** Local-day key (YYYY-MM-DD) for a date — the calendar groups by local day. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Day key for a row's deadline (its placement field), or null when unscheduled. */
export function rowDayKey(row: WorkOrderRow): string | null {
  if (!row.deadlineAt) return null;
  const d = new Date(row.deadlineAt);
  if (Number.isNaN(d.getTime())) return null;
  return dayKey(d);
}

/** Bucket rows by their deadline day. Rows with no deadline are dropped. */
export function bucketByDay(rows: WorkOrderRow[]): Map<string, WorkOrderRow[]> {
  const map = new Map<string, WorkOrderRow[]>();
  for (const row of rows) {
    const key = rowDayKey(row);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * The 6×7 (42-cell) grid of days for a month view, Sunday-first, including the
 * leading/trailing days of adjacent months so every week is full.
 */
export function monthGridDays(visibleMonth: Date): Date[] {
  const firstOfMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay()); // back up to the Sunday on/before the 1st

  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  return days;
}

/** Inclusive-start / exclusive-end UTC bounds covering the whole month grid. */
export function monthGridRange(visibleMonth: Date): { from: Date; to: Date } {
  const days = monthGridDays(visibleMonth);
  const first = days[0];
  const last = days[days.length - 1];
  const from = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { from, to };
}
