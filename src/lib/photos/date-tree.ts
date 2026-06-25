/**
 * Derive a Year → Month → Day → PO# navigation tree from the loaded library
 * photos (client-side; reflects whatever pages are loaded). Days bucket by
 * America/Los_Angeles so they line up with the rest of the library's PST date
 * grouping, and each day's PO refs come from `poRef`.
 */
import type { LibraryPhoto } from '@/components/photos/photo-library-types';

export interface DatePoNode {
  ref: string;
  count: number;
}
export interface DateDayNode {
  /** `YYYY-MM-DD` (PST) — what we set as dateFrom/dateTo when drilled. */
  ymd: string;
  dayLabel: string;
  count: number;
  pos: DatePoNode[];
}
export interface DateMonthNode {
  key: string; // `YYYY-MM`
  label: string;
  count: number;
  days: DateDayNode[];
}
export interface DateYearNode {
  year: string;
  count: number;
  months: DateMonthNode[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const PST = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function pstParts(iso: string): { y: string; m: string; d: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = PST.formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return y && m && d ? { y, m, d } : null;
}

export function buildPhotoDateTree(photos: LibraryPhoto[]): DateYearNode[] {
  // year -> month -> day -> { count, poRef -> count }
  const years = new Map<string, Map<string, Map<string, { count: number; pos: Map<string, number> }>>>();

  for (const photo of photos) {
    const parts = pstParts(photo.createdAt);
    if (!parts) continue;
    const { y, m, d } = parts;
    const months = years.get(y) ?? new Map();
    years.set(y, months);
    const days = months.get(m) ?? new Map();
    months.set(m, days);
    const day = days.get(d) ?? { count: 0, pos: new Map<string, number>() };
    days.set(d, day);
    day.count += 1;
    const ref = photo.poRef?.trim();
    if (ref) day.pos.set(ref, (day.pos.get(ref) ?? 0) + 1);
  }

  const sortNumDesc = (a: string, b: string) => Number(b) - Number(a);

  return [...years.keys()].sort(sortNumDesc).map((year) => {
    const months = years.get(year)!;
    const monthNodes: DateMonthNode[] = [...months.keys()].sort(sortNumDesc).map((m) => {
      const days = months.get(m)!;
      const dayNodes: DateDayNode[] = [...days.keys()].sort(sortNumDesc).map((d) => {
        const day = days.get(d)!;
        const pos: DatePoNode[] = [...day.pos.entries()]
          .map(([ref, count]) => ({ ref, count }))
          .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref));
        return {
          ymd: `${year}-${m}-${d}`,
          dayLabel: `${MONTHS[Number(m) - 1]?.slice(0, 3) ?? m} ${Number(d)}`,
          count: day.count,
          pos,
        };
      });
      const count = dayNodes.reduce((sum, dn) => sum + dn.count, 0);
      return { key: `${year}-${m}`, label: MONTHS[Number(m) - 1] ?? m, count, days: dayNodes };
    });
    const count = monthNodes.reduce((sum, mn) => sum + mn.count, 0);
    return { year, count, months: monthNodes };
  });
}
