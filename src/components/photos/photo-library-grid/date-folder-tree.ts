import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { isoWeekNumber, weekRange } from '@/lib/photos/date-hierarchy';
import type { PhotoDateNav } from './types';

// ── Folders view (date drill) ───────────────────────────────────────────────
//
// The folders view is a Year → Month → Week → Day → PO# drill, all keyed off
// `created_at` (PST). Each level renders as a grid of folder tiles; drilling a
// day reveals that day's PO# folders, and opening a PO# folder shows its photos
// as a contact sheet with the shared lightbox. There are no saved/master
// folders any more — the hierarchy is derived from capture time.

export const UNLINKED_PO_KEY = '__unlinked__';

const PST_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** PST `YYYY-MM-DD` for a photo's capture time (en-CA already emits that shape). */
function pstYmd(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return PST_YMD.format(date);
}

/** ISO week number for a `YYYY-MM-DD` string (computed in UTC to dodge DST). */
export function isoWeekForYmd(ymd: string): number {
  return isoWeekNumber(new Date(`${ymd}T00:00:00Z`));
}

export function poLabel(poRef: string, scope: PhotoLibrarySourceScope): string {
  if (scope === 'local_pickup') return `Pickup ${poRef}`;
  if (scope === 'packing') return `Order ${poRef}`;
  if (scope === 'repair') return `Unit ${poRef}`;
  return `PO ${poRef}`;
}

interface DayBucket {
  ymd: string;
  photos: LibraryPhoto[];
}
interface WeekBucket {
  key: string;
  week: number;
  days: Map<string, DayBucket>;
}
interface MonthBucket {
  key: string; // YYYY-MM
  month: number; // 0-based
  weeks: Map<string, WeekBucket>;
}
export interface YearBucket {
  year: string;
  months: Map<string, MonthBucket>;
}

/** Bucket photos into Year → Month → Week → Day by PST capture date. */
export function buildDateFolderTree(photos: LibraryPhoto[]): Map<string, YearBucket> {
  const years = new Map<string, YearBucket>();
  for (const photo of photos) {
    const ymd = pstYmd(photo.createdAt);
    if (!ymd) continue;
    const [y, m] = ymd.split('-');
    const year = years.get(y) ?? { year: y, months: new Map() };
    years.set(y, year);
    const mKey = `${y}-${m}`;
    const month = year.months.get(mKey) ?? { key: mKey, month: Number(m) - 1, weeks: new Map() };
    year.months.set(mKey, month);
    const week = isoWeekForYmd(ymd);
    const wKey = `${y}-W${week}`;
    const wk = month.weeks.get(wKey) ?? { key: wKey, week, days: new Map() };
    month.weeks.set(wKey, wk);
    const dayBucket = wk.days.get(ymd) ?? { ymd, photos: [] };
    wk.days.set(ymd, dayBucket);
    dayBucket.photos.push(photo);
  }
  return years;
}

export interface FolderTileData {
  key: string;
  label: string;
  /** Newest photo in the subtree — drives the cover + meta timestamp. */
  cover: LibraryPhoto | undefined;
  count: number;
  latestAt: string;
}

/** Reduce a list of photos to a folder tile's cover/count/latest meta. */
export function tileMeta(key: string, label: string, photos: LibraryPhoto[]): FolderTileData {
  let cover = photos[0];
  let latestAt = photos[0]?.createdAt ?? '';
  for (const p of photos) {
    if (p.createdAt > latestAt) {
      latestAt = p.createdAt;
      cover = p;
    }
  }
  return { key, label, cover, count: photos.length, latestAt };
}

/** Range a folder click applies, by level. */
export function yearRangeOf(y: string): PhotoDateNav {
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
}
export function monthRangeOf(mKey: string): PhotoDateNav {
  const [y, m] = mKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { dateFrom: `${mKey}-01`, dateTo: `${mKey}-${String(last).padStart(2, '0')}` };
}
export function weekRangeOf(ymd: string): PhotoDateNav {
  const r = weekRange(new Date(`${ymd}T00:00:00Z`));
  return { dateFrom: r.dateFrom, dateTo: r.dateTo };
}

/** `Jun 23` from a `YYYY-MM-DD` string. */
export function dayTileLabel(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${MONTH_NAMES[Number(m) - 1]?.slice(0, 3) ?? m} ${Number(d)}`;
}
