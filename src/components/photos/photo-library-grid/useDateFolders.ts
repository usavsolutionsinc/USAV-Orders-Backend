'use client';

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import type { LibraryPhoto } from '../photo-library-types';
import type { PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { describePhotoDatePath } from '@/lib/photos/date-hierarchy';
import type { PhotoGalleryInput } from '@/components/shipped/photo-gallery/photo-gallery-utils';
import { toGalleryInputs } from './photo-grid-format';
import {
  buildFolderTileOpenHandler,
  monthRangeOf,
  resolveFolderBrowseState,
  type FolderTileData,
  weekRangeOf,
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
  tiles: FolderTileData[];
  onOpen: (tile: FolderTileData) => void;
}

/**
 * Date-drill folders view, driven by the active URL date filter (single source
 * of truth — the same state the bottom breadcrumb reads). Drill level + tiles
 * come from {@link resolveFolderBrowseState}; the page header reads the same
 * model via {@link describeFolderBrowseHeader}.
 */
export function useDateFolders({
  photos,
  scope,
  dateFrom,
  dateTo,
  poRef,
  onNavigate,
}: UseDateFoldersArgs): DateFoldersState {
  const browseArgs = useMemo(
    () => ({ photos, scope, dateFrom, dateTo, poRef }),
    [photos, scope, dateFrom, dateTo, poRef],
  );
  const browse = useMemo(() => resolveFolderBrowseState(browseArgs), [browseArgs]);
  const onOpen = useMemo(
    () => buildFolderTileOpenHandler(browseArgs, onNavigate),
    [browseArgs, onNavigate],
  );

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const leafInputs = useMemo(() => toGalleryInputs(photos, scope), [photos, scope]);

  const datePath = useMemo(() => describePhotoDatePath({ dateFrom, dateTo }), [dateFrom, dateTo]);
  const level = datePath.length === 0 ? 'root' : datePath[datePath.length - 1]!.key;
  const anchor = dateFrom;

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

  return {
    isLeaf: browse.isLeaf,
    leafInputs,
    openIndex,
    setOpenIndex,
    tiles: browse.tiles,
    onOpen,
  };
}
