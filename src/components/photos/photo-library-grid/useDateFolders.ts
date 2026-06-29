'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { describePhotoDatePath } from '@/lib/photos/date-hierarchy';
import type { PhotoGalleryInput } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { toGalleryInputs } from './photo-grid-format';
import {
  buildDateFolderTree,
  dayTileLabel,
  type FolderTileData,
  isoWeekForYmd,
  MONTH_NAMES,
  monthRangeOf,
  poLabel,
  tileMeta,
  UNLINKED_PO_KEY,
  weekRangeOf,
  yearRangeOf,
} from './date-folder-tree';
import type { PhotoDateNav } from './types';

interface UseDateFoldersArgs {
  photos: LibraryPhoto[];
  scope: PhotoLibrarySourceScope;
  dateFrom?: string;
  dateTo?: string;
  poRef?: string;
  onNavigate: (nav: PhotoDateNav) => void;
}

interface DateFoldersState {
  isLeaf: boolean;
  leafInputs: PhotoGalleryInput[];
  openIndex: number | null;
  setOpenIndex: Dispatch<SetStateAction<number | null>>;
  eyebrow: string;
  tiles: FolderTileData[];
  onOpen: (tile: FolderTileData) => void;
}

/**
 * Date-drill folders view, driven by the active URL date filter (single source
 * of truth — the same state the bottom breadcrumb reads). The drill LEVEL is the
 * granularity of the active range: no date → Years, a year span → Months, a
 * month → Weeks, a week → Days, a day → that day's PO# folders, and a PO# (or a
 * single-PO day / custom range) → a photo contact sheet. Clicking a folder
 * *narrows* the filter via `onNavigate`; the breadcrumb *widens* it. Because the
 * server already scopes `photos` to the active range, every level reads straight
 * off the loaded photos — so "on week 26" shows that week's day folders, not a
 * stale Years view.
 */
export function useDateFolders({
  photos,
  scope,
  dateFrom,
  dateTo,
  poRef,
  onNavigate,
}: UseDateFoldersArgs): DateFoldersState {
  const tree = useMemo(() => buildDateFolderTree(photos), [photos]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Classify the active range into a level via the shared date-path model, then
  // resolve the matching tree nodes off the (already range-scoped) photos.
  const datePath = useMemo(() => describePhotoDatePath({ dateFrom, dateTo }), [dateFrom, dateTo]);
  const level = datePath.length === 0 ? 'root' : datePath[datePath.length - 1].key;
  const anchor = dateFrom;
  const yKey = anchor?.slice(0, 4);
  const mKey = anchor?.slice(0, 7);

  const year = yKey ? tree.get(yKey) : undefined;
  const month = year && mKey ? year.months.get(mKey) : undefined;
  const week = month && anchor ? month.weeks.get(`${yKey}-W${isoWeekForYmd(anchor)}`) : undefined;
  const day = week && anchor ? week.days.get(anchor) : undefined;

  const dayPhotos = day?.photos ?? [];
  const poGroups = useMemo(() => {
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
  }, [dayPhotos]);

  // The leaf is a flat contact sheet: an explicit PO#, a single-PO day, or any
  // custom range. `photos` is already server-scoped, so it IS the leaf set.
  const isLeaf =
    Boolean(poRef) ||
    level === 'custom' ||
    (level === 'day' && poGroups.order.length <= 1);
  const leafInputs = useMemo(() => toGalleryInputs(photos, scope), [photos, scope]);
  useEffect(() => setOpenIndex(null), [dateFrom, dateTo, poRef]);

  // Empty-day fallback: if a single day is selected (e.g. today on open) but it
  // has no photos, widen to that day's week so the operator lands on day folders
  // instead of a dead-empty day. Empty-week widens to the month the same way.
  useEffect(() => {
    if (poRef || !anchor || photos.length > 0) return;
    if (level === 'day') {
      onNavigate(weekRangeOf(anchor));
    } else if (level === 'week') {
      onNavigate(monthRangeOf(anchor.slice(0, 7)));
    }
  }, [level, poRef, anchor, photos.length, onNavigate]);

  // ── Folder grid for the current level ─────────────────────────────────────
  let eyebrow = 'Years';
  let tiles: FolderTileData[] = [];
  let onOpen: (tile: FolderTileData) => void = () => {};

  if (level === 'day' && day) {
    eyebrow = 'POs';
    tiles = poGroups.order.map((key) => {
      const list = poGroups.map.get(key)!;
      const ref = key === UNLINKED_PO_KEY ? null : key.replace(/^po:/, '');
      return tileMeta(key, ref ? poLabel(ref, scope) : 'Unlinked', list);
    });
    onOpen = (t) =>
      onNavigate({
        dateFrom,
        dateTo,
        poRef: t.key === UNLINKED_PO_KEY ? undefined : t.key.replace(/^po:/, ''),
      });
  } else if (level === 'week' && week) {
    eyebrow = 'Days';
    tiles = [...week.days.values()]
      .sort((a, b) => b.ymd.localeCompare(a.ymd))
      .map((d) => tileMeta(d.ymd, dayTileLabel(d.ymd), d.photos));
    onOpen = (t) => onNavigate({ dateFrom: t.key, dateTo: t.key });
  } else if (level === 'month' && month) {
    eyebrow = 'Weeks';
    tiles = [...month.weeks.values()]
      .sort((a, b) => b.week - a.week)
      .map((w) => tileMeta(w.key, `Week ${w.week}`, [...w.days.values()].flatMap((d) => d.photos)));
    // Anchor the week range on its earliest day so the filter spans Mon–Sun.
    onOpen = (t) => {
      const wk = month.weeks.get(t.key);
      const firstDay = wk ? [...wk.days.keys()].sort()[0] : undefined;
      if (firstDay) onNavigate(weekRangeOf(firstDay));
    };
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
    onOpen = (t) => onNavigate(monthRangeOf(t.key));
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
    onOpen = (t) => onNavigate(yearRangeOf(t.key));
  }

  return { isLeaf, leafInputs, openIndex, setOpenIndex, eyebrow, tiles, onOpen };
}
