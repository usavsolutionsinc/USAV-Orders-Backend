import { toPSTDateKey } from '@/utils/date';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';

export interface CombineData {
  pending: FbaBoardItem[];
}

/** Compute Monday–Sunday YYYY-MM-DD range for the week containing today shifted by `weekOffset`. */
export function getWeekRange(todayKey: string, weekOffset: number): { startStr: string; endStr: string } {
  const [y, m, d] = todayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + weekOffset * 7);
  const dow = date.getUTCDay(); // 0=Sun
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((dow + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return { startStr: fmt(monday), endStr: fmt(sunday) };
}

export function isItemInWeek(item: FbaBoardItem, start: string, end: string): boolean {
  const key = item.due_date ? toPSTDateKey(item.due_date) : '';
  if (!key) return true; // items without a date always show
  return key >= start && key <= end;
}
