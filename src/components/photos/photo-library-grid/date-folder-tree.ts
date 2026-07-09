import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { describePhotoDatePath, dayLabel, isoWeekNumber, weekRange, weekRangeLabel } from '@/lib/photos/date-hierarchy';
import {
  photoGroupHeaderLabel,
  photoGroupKey,
  UNLINKED_PHOTO_GROUP_KEY,
} from '@/lib/photos/display-names';
import type { PhotoDateNav } from './types';

// ── Folders view (date drill) ───────────────────────────────────────────────
//
// The folders view is a Year → Month → Week → Day → PO# drill, all keyed off
// `created_at` (PST). Each level renders as a grid of folder tiles; drilling a
// day reveals that day's PO# folders, and opening a PO# folder shows its photos
// as a contact sheet with the shared lightbox. There are no saved/master
// folders any more — the hierarchy is derived from capture time.

export const UNLINKED_PO_KEY = UNLINKED_PHOTO_GROUP_KEY;

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
  count: number;
  latestAt: string;
  /** First photo in a PO/ticket group — shown as the folder cover preview. */
  previewPhoto?: LibraryPhoto;
}

/** Reduce a list of photos to a folder tile's count/latest meta. */
export function tileMeta(
  key: string,
  label: string,
  photos: LibraryPhoto[],
  opts?: { previewPhoto?: LibraryPhoto },
): FolderTileData {
  let latestAt = photos[0]?.createdAt ?? '';
  for (const p of photos) {
    if (p.createdAt > latestAt) latestAt = p.createdAt;
  }
  return { key, label, count: photos.length, latestAt, previewPhoto: opts?.previewPhoto };
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

/** Week folder label from the capture days present in that week bucket. */
export function weekTileLabel(w: WeekBucket): string {
  const days = [...w.days.keys()].sort();
  if (!days.length) return `W${w.week}`;
  return weekRangeLabel(days[0]!, days[days.length - 1]!);
}

/** `June 23` from a `YYYY-MM-DD` string. */
export const dayTileLabel = dayLabel;

export type FolderBrowseLevel = 'root' | 'year' | 'month' | 'week' | 'day' | 'custom';

export interface FolderBrowseState {
  eyebrow: string;
  tiles: FolderTileData[];
  isLeaf: boolean;
  leafTitle?: string;
  level: FolderBrowseLevel;
  /** Photos to render at a contact-sheet leaf (subset of the loaded page). */
  leafPhotos: LibraryPhoto[];
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
  ticketId?: string;
}

function groupDayByRef(dayPhotos: LibraryPhoto[], scope: PhotoLibrarySourceScope) {
  const order: string[] = [];
  const map = new Map<string, LibraryPhoto[]>();
  for (const p of dayPhotos) {
    const key =
      scope === 'claims'
        ? photoGroupKey(p, scope)
        : p.poRef?.trim()
          ? `po:${p.poRef.trim()}`
          : UNLINKED_PO_KEY;
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
  ticketId: string | undefined,
  level: FolderBrowseLevel,
  dayGroups: ReturnType<typeof groupDayByRef>,
  customLabel: string | undefined,
): string | undefined {
  if (ticketId?.trim()) {
    return photoGroupHeaderLabel(`ticket:${ticketId.trim()}`, scope);
  }
  if (poRef?.trim()) return poLabel(poRef.trim(), scope);
  if (level === 'custom' && customLabel) return customLabel;
  if (level === 'day' && dayGroups.order.length === 1) {
    const key = dayGroups.order[0]!;
    if (key === UNLINKED_PO_KEY) return 'Unlinked';
    if (key.startsWith('ticket:')) {
      return photoGroupHeaderLabel(key, scope);
    }
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
  ticketId,
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
  const dayGroups = groupDayByRef(dayPhotos, scope);
  const customLabel =
    level === 'custom' ? datePath[datePath.length - 1]?.label : undefined;

  const isLeaf =
    Boolean(poRef?.trim()) ||
    Boolean(ticketId?.trim()) ||
    level === 'custom' ||
    (level === 'day' && scope !== 'claims' && dayGroups.order.length <= 1);

  const leafPhotos = (() => {
    if (!isLeaf) return [];
    if (ticketId?.trim() || poRef?.trim()) return photos;
    if (level === 'day' && day) return day.photos;
    if (level === 'custom') return photos;
    if (level === 'day' && dayGroups.order.length === 1) {
      return dayGroups.map.get(dayGroups.order[0]!) ?? photos;
    }
    return photos;
  })();

  const leafTitle = isLeaf
    ? leafTitleFor(scope, poRef, ticketId, level, dayGroups, customLabel)
    : undefined;

  let eyebrow = 'Years';
  let tiles: FolderTileData[] = [];

  if (level === 'day' && day) {
    eyebrow = scope === 'claims' ? 'Tickets' : 'POs';
    tiles = dayGroups.order.map((key) => {
      const list = dayGroups.map.get(key)!;
      const previewPhoto = list[0];
      if (key === UNLINKED_PO_KEY) {
        return tileMeta(key, 'Unlinked', list, { previewPhoto });
      }
      if (key.startsWith('ticket:')) {
        return tileMeta(key, photoGroupHeaderLabel(key, scope), list, { previewPhoto });
      }
      const ref = key.replace(/^po:/, '');
      return tileMeta(key, poLabel(ref, scope), list, { previewPhoto });
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
      .map((w) => tileMeta(w.key, weekTileLabel(w), [...w.days.values()].flatMap((d) => d.photos)));
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

  return { eyebrow, tiles, isLeaf, leafTitle, level, leafPhotos };
}

/** Header copy for the folders view — level eyebrow + count, or leaf title + photo count. */
export function describeFolderBrowseHeader(
  args: ResolveFolderBrowseArgs,
): FolderBrowseHeaderContext {
  const state = resolveFolderBrowseState(args);
  if (state.isLeaf) {
    return {
      title: state.leafTitle ?? 'Photos',
      count: state.leafPhotos.length,
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
        if (args.scope === 'claims' && tile.key.startsWith('ticket:')) {
          onNavigate({
            dateFrom,
            dateTo,
            ticketId: tile.key.slice('ticket:'.length),
            poRef: undefined,
          });
        } else {
          onNavigate({
            dateFrom,
            dateTo,
            poRef: tile.key === UNLINKED_PO_KEY ? undefined : tile.key.replace(/^po:/, ''),
            ticketId: undefined,
          });
        }
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
