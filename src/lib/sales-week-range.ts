import { getCurrentPSTDateKey } from '@/utils/date';

/**
 * Returns Mon–Sun week range for the given offset (0 = current week).
 * Unlike dashboard-week-range.ts (Mon–Fri), sales include weekends.
 */
export function getSalesWeekRange(weekOffset: number) {
  const baseDateKey = getCurrentPSTDateKey();
  const [y, m, d] = baseDateKey.split('-').map(Number);
  const now = new Date(y, (m || 1) - 1, d || 1);
  const day = now.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;

  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday - weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  return { startStr: fmt(monday), endStr: fmt(sunday) };
}
