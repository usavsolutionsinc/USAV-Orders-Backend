/**
 * Date-hierarchy breadcrumb model for the photo library.
 *
 * The library's "folder breadcrumb" IS the active date filter rendered as a
 * clickable Year → Month → Week → Day path (e.g. `2026 / June / Week 25 / Jun 17`).
 * Each crumb carries the date range that clicking it applies, so the breadcrumb
 * doubles as a widen-the-filter navigator.
 *
 * All math is calendar arithmetic on the `YYYY-MM-DD` PST date strings the rest
 * of the library already uses (see `date-tree.ts`); we compute in UTC purely to
 * dodge DST, never to shift the calendar day. Weeks are ISO-8601 (Monday start,
 * week 1 = the week containing the first Thursday) so "Week 25" matches what
 * operators read off a calendar.
 */

export interface PhotoDateRange {
  dateFrom: string;
  dateTo: string;
}

export interface PhotoDateCrumb {
  key: 'year' | 'month' | 'week' | 'day' | 'custom';
  label: string;
  /** The range that clicking this crumb applies (widen-to-here). */
  range: PhotoDateRange;
  /** True for the deepest (currently-selected) crumb. */
  current: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const DAY_MS = 86_400_000;

function ymdToUtc(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Reject impossible dates (e.g. 2026-02-31) — the round-trip won't match.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function utcToYmd(dt: Date): string {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function addDays(dt: Date, n: number): Date {
  return new Date(dt.getTime() + n * DAY_MS);
}

/** Monday of the ISO week containing `dt`. */
export function startOfIsoWeek(dt: Date): Date {
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(dt, -dow);
}

/** ISO-8601 week number (1–53) for the date. */
export function isoWeekNumber(dt: Date): number {
  const thursday = addDays(startOfIsoWeek(dt), 3);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstThursday = addDays(startOfIsoWeek(jan4), 3);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

function dayRange(dt: Date): PhotoDateRange {
  const s = utcToYmd(dt);
  return { dateFrom: s, dateTo: s };
}

export function weekRange(dt: Date): PhotoDateRange {
  const monday = startOfIsoWeek(dt);
  return { dateFrom: utcToYmd(monday), dateTo: utcToYmd(addDays(monday, 6)) };
}

function monthRange(dt: Date): PhotoDateRange {
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  return {
    dateFrom: utcToYmd(new Date(Date.UTC(y, m, 1))),
    dateTo: utcToYmd(new Date(Date.UTC(y, m + 1, 0))),
  };
}

function yearRange(dt: Date): PhotoDateRange {
  const y = dt.getUTCFullYear();
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
}

function shortLabel(ymd: string): string {
  const dt = ymdToUtc(ymd);
  if (!dt) return ymd;
  return `${MONTHS[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCDate()}`;
}

function rangeEquals(a: PhotoDateRange, from: string, to: string): boolean {
  return a.dateFrom === from && a.dateTo === to;
}

/**
 * Derive the clickable Year → Month → Week → Day crumbs for the active date
 * filter. Returns `[]` when no date is selected (the breadcrumb shows just its
 * "All dates" root). An arbitrary span that matches none of the day/week/month/
 * year boundaries collapses to a single `custom` crumb labelled with its range.
 */
export function describePhotoDatePath(filters: {
  dateFrom?: string;
  dateTo?: string;
}): PhotoDateCrumb[] {
  const from = filters.dateFrom;
  if (!from) return [];
  const anchor = ymdToUtc(from);
  if (!anchor) return [];
  const to = filters.dateTo ?? from;

  const day = dayRange(anchor);
  const week = weekRange(anchor);
  const month = monthRange(anchor);
  const year = yearRange(anchor);

  let level: PhotoDateCrumb['key'];
  if (rangeEquals(day, from, to)) level = 'day';
  else if (rangeEquals(week, from, to)) level = 'week';
  else if (rangeEquals(month, from, to)) level = 'month';
  else if (rangeEquals(year, from, to)) level = 'year';
  else level = 'custom';

  if (level === 'custom') {
    const label = from === to ? shortLabel(from) : `${shortLabel(from)} – ${shortLabel(to)}`;
    return [{ key: 'custom', label, range: { dateFrom: from, dateTo: to }, current: true }];
  }

  const crumbs: PhotoDateCrumb[] = [
    { key: 'year', label: String(anchor.getUTCFullYear()), range: year, current: level === 'year' },
  ];
  if (level === 'month' || level === 'week' || level === 'day') {
    crumbs.push({
      key: 'month',
      label: MONTHS[anchor.getUTCMonth()],
      range: month,
      current: level === 'month',
    });
  }
  if (level === 'week' || level === 'day') {
    crumbs.push({
      key: 'week',
      label: `Week ${isoWeekNumber(anchor)}`,
      range: week,
      current: level === 'week',
    });
  }
  if (level === 'day') {
    crumbs.push({ key: 'day', label: shortLabel(from), range: day, current: true });
  }
  return crumbs;
}
