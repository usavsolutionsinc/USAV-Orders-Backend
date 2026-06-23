'use client';

import { useCallback, useMemo, useState } from 'react';
import type { LibraryPhoto } from '@/components/photos/photo-library-types';

export interface PhotoSelectMods {
  /** Shift was held — extend a contiguous range from the anchor. */
  shift?: boolean;
}

export interface PhotoSelection {
  /** Set of selected photo ids (persists across the client pages). */
  selected: Set<number>;
  /** Selected rows, resolved against the full loaded list, in list order. */
  selectedPhotos: LibraryPhoto[];
  /** Whether any selection UI (checkmarks, action bar) should be visible. */
  isActive: boolean;
  isSelected: (id: number) => boolean;
  /**
   * Select/toggle a tile. `shift` extends a contiguous range from the last
   * anchor (Shift+click); a plain/Ctrl/Cmd click toggles the single tile and
   * moves the anchor. Range is computed over the flat sort order so it behaves
   * predictably even though the grid is grouped by day/folder.
   */
  selectTile: (id: number, mods?: PhotoSelectMods) => void;
  /** Select every currently-loaded photo (the header "select all"). */
  selectAll: () => void;
  /** Clear the whole selection. */
  clear: () => void;
  /** Ensure `id` is part of the selection set used for a drag payload: returns
   *  the ids to drag — the full selection if `id` is already in it, else just
   *  `[id]` (Finder-style "drag the unselected item alone, don't disturb the set"). */
  resolveDragIds: (id: number) => number[];
}

/**
 * Owns multi-selection for the photo library: click-to-toggle, Shift+click
 * range, Ctrl/Cmd+click toggle, and cross-page persistence.
 *
 * Selection is keyed by id and is NOT pruned to the visible page — the infinite
 * query retains every loaded page, so a selection made on page 1 survives
 * paging to page 5 and a drag can carry the whole set. `selectedPhotos` resolves
 * ids against the full `photos` accumulator.
 *
 * @param photos The full, ordered list of loaded photos (sort order preserved).
 */
export function usePhotoSelection(photos: LibraryPhoto[]): PhotoSelection {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Anchor for Shift+click range extension (last individually-clicked tile).
  const [anchorId, setAnchorId] = useState<number | null>(null);

  // id → index in the flat sort order, for range math.
  const indexById = useMemo(
    () => new Map(photos.map((p, i) => [p.id, i] as const)),
    [photos],
  );

  const selectedPhotos = useMemo(
    () => photos.filter((p) => selected.has(p.id)),
    [photos, selected],
  );

  const isSelected = useCallback((id: number) => selected.has(id), [selected]);

  const selectTile = useCallback(
    (id: number, mods: PhotoSelectMods = {}) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = anchorId;
        if (mods.shift && from != null && indexById.has(from) && indexById.has(id)) {
          // Range: add every photo between the anchor and the target (inclusive).
          const a = indexById.get(from)!;
          const b = indexById.get(id)!;
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(photos[i].id);
          return next;
        }
        // Toggle a single tile and move the anchor here.
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // A non-range click (re)sets the anchor; a range extension keeps it.
      if (!mods.shift) setAnchorId(id);
    },
    [anchorId, indexById, photos],
  );

  const selectAll = useCallback(() => {
    setSelected(new Set(photos.map((p) => p.id)));
  }, [photos]);

  const clear = useCallback(() => {
    setSelected(new Set());
    setAnchorId(null);
  }, []);

  const resolveDragIds = useCallback(
    (id: number) => (selected.has(id) && selected.size > 0 ? [...selected] : [id]),
    [selected],
  );

  return {
    selected,
    selectedPhotos,
    isActive: selected.size > 0,
    isSelected,
    selectTile,
    selectAll,
    clear,
    resolveDragIds,
  };
}
