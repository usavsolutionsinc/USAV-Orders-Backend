import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { describePhotoDatePath, isoWeekNumber, weekRange } from '@/lib/photos/date-hierarchy';
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

export type FolderBrowseLevel = 'root' | 'year' | 'month' | 'week' | 'day' | 'custom';

export interface FolderBrowseState {
  eyebrow: string;
  tiles: FolderTileData[];
  isLeaf: boolean;
  leafTitle?: string;
  level: FolderBrowseLevel;
}

export interface FolderBrowseHeaderContext {
  /** Level eyebrow (POs, Days, …) or leaf title (PO PO_6818). */
  title: string;
  /** Folder count at this level, or photo count at a leaf. */
  count: number;
  isLeaf: boolean;
}

interface ResolveFolderBrowseArgs {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
}

function groupDayByPo(dayPhotos: LibraryPhoto[]) {
  const order: string[] = [];
  const map = new Map<string, LibraryPhoto[]>();
  for (const p of dayPhotos) {
    const ref = p.poRef?.trim();
    const key = ref ? `po:${ref}` : UNLINKED_PO_KEY;
    const list = map.get(key) ?? [];
    if (list.length === 0) order.push(key);
    list.push(p);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { order, map };
}

function leafTitleFor(
  scope: PhotoLibrarySourceScope,
  poRef: string | undefined,
  level: FolderBrowseLevel,
  poGroups: ReturnType<typeof groupDayByPo>,
  customLabel: string | undefined,
): string | undefined {
  if (poRef?.trim()) return poLabel(poRef.trim(), scope);
  if (level === 'custom' && customLabel) return customLabel;
  if (level === 'day' && poGroups.order.length === 1) {
    const key = poGroups.order[0]!;
    if (key === UNLINKED_PO_KEY) return 'Unlinked';
    return poLabel(key.replace(/^po:/, ''), scope);
  }
  return undefined;
}

/**
 * Resolve the folders-view drill level: eyebrow, child tiles, and whether the
 * operator is at a photo contact-sheet leaf. Shared by the grid hook and the
 * page header so both stay in sync with the URL date filter.
 */
export function resolveFolderBrowseState({
  photos,
  scope,
  dateFrom,
  dateTo,
  poRef,
}: ResolveFolderBrowseArgs): FolderBrowseState {
  const tree = buildDateFolderTree(photos);
  const datePath = describePhotoDatePath({ dateFrom, dateTo });
  const level: FolderBrowseLevel =
    datePath.length === 0 ? 'root' : datePath[datePath.length - 1]!.key;
  const anchor = dateFrom;
  const yKey = anchor?.slice(0, 4);
  const mKey = anchor?.slice(0, 7);

  const year = yKey ? tree.get(yKey) : undefined;
  const month = year && mKey ? year.months.get(mKey) : undefined;
  const week = month && anchor ? month.weeks.get(`${yKey}-W${isoWeekForYmd(anchor)}`) : undefined;
  const day = week && anchor ? week.days.get(anchor) : undefined;

  const dayPhotos = day?.photos ?? [];
  const poGroups = groupDayByPo(dayPhotos);
  const customLabel =
    level === 'custom' ? datePath[datePath.length - 1]?.label : undefined;

  const isLeaf =
    Boolean(poRef?.trim()) ||
    level === 'custom' ||
    (level === 'day' && poGroups.order.length <= 1);

  const leafTitle = isLeaf
    ? leafTitleFor(scope, poRef, level, poGroups, customLabel)
    : undefined;

  let eyebrow = 'Years';
  let tiles: FolderTileData[] = [];

  if (level === 'day' && day) {
    eyebrow = 'POs';
    tiles = poGroups.order.map((key) => {
      const list = poGroups.map.get(key)!;
      const ref = key === UNLINKED_PO_KEY ? null : key.replace(/^po:/, '');
      return tileMeta(key, ref ? poLabel(ref, scope) : 'Unlinked', list);
    });
  } else if (level === 'week' && week) {
    eyebrow = 'Days';
    tiles = [...week.days.values()]
      .sort((a, b) => b.ymd.localeCompare(a.ymd))
      .map((d) => tileMeta(d.ymd, dayTileLabel(d.ymd), d.photos));
  } else if (level === 'month' && month) {
    eyebrow = 'Weeks';
    tiles = [...month.weeks.values()]
      .sort((a, b) => b.week - a.week)
      .map((w) => tileMeta(w.key, `Week ${w.week}`, [...w.days.values()].flatMap((d) => d.photos)));
  } else if (level === 'year' && year) {
    eyebrow = 'Months';
    tiles = [...year.months.values()]
      .sort((a, b) => b.month - a.month)
      .map((m) =>
        tileMeta(
          m.key,
          MONTH_NAMES[m.month] ?? m.key,
          [...m.weeks.values()].flatMap((w) => [...w.days.values()].flatMap((d) => d.photos)),
        ),
      );
  } else {
    eyebrow = 'Years';
    tiles = [...tree.values()]
      .sort((a, b) => Number(b.year) - Number(a.year))
      .map((y) =>
        tileMeta(
          y.year,
          y.year,
          [...y.months.values()].flatMap((m) =>
            [...m.weeks.values()].flatMap((w) => [...w.days.values()].flatMap((d) => d.photos)),
          ),
        ),
      );
  }

  return { eyebrow, tiles, isLeaf, leafTitle, level };
}

/** Header copy for the folders view — level eyebrow + count, or leaf title + photo count. */
export function describeFolderBrowseHeader(
  args: ResolveFolderBrowseArgs,
): FolderBrowseHeaderContext {
  const state = resolveFolderBrowseState(args);
  if (state.isLeaf) {
    return {
      title: state.leafTitle ?? 'Photos',
      count: args.photos.length,
      isLeaf: true,
    };
  }
  return {
    title: state.eyebrow,
    count: state.tiles.length,
    isLeaf: false,
  };
}

/** Navigate one folder level deeper when a tile is clicked. */
export function buildFolderTileOpenHandler(
  args: ResolveFolderBrowseArgs,
  onNavigate: (nav: PhotoDateNav) => void,
): (tile: FolderTileData) => void {
  const { photos, dateFrom, dateTo } = args;
  const state = resolveFolderBrowseState(args);
  const tree = buildDateFolderTree(photos);
  const anchor = dateFrom;
  const yKey = anchor?.slice(0, 4);
  const mKey = anchor?.slice(0, 7);
  const year = yKey ? tree.get(yKey) : undefined;
  const month = year && mKey ? year.months.get(mKey) : undefined;

  return (tile) => {
    switch (state.level) {
      case 'day':
        onNavigate({
          dateFrom,
          dateTo,
          poRef: tile.key === UNLINKED_PO_KEY ? undefined : tile.key.replace(/^po:/, ''),
        });
        break;
      case 'week':
        onNavigate({ dateFrom: tile.key, dateTo: tile.key });
        break;
      case 'month': {
        const wk = month?.weeks.get(tile.key);
        const firstDay = wk ? [...wk.days.keys()].sort()[0] : undefined;
        if (firstDay) onNavigate(weekRangeOf(firstDay));
        break;
      }
      case 'year':
        onNavigate(monthRangeOf(tile.key));
        break;
      default:
        onNavigate(yearRangeOf(tile.key));
        break;
    }
  };
}
