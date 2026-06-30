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
   * Select/toggle a tile. A plain/Ctrl/Cmd click toggles the single tile and
   * moves the anchor. `shift` paints the range [anchor, target] with the anchor's
   * action — **select** if the anchor click selected, **deselect** if it cleared.
   * The range re-derives from the anchor-click baseline each time, so moving the
   * target back toward the anchor SHRINKS it (and dragging past flips direction),
   * exactly like Finder / Google Photos. Range is computed over the flat sort
   * order so it behaves predictably even though the grid is grouped by day/folder.
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
  // Anchor for Shift+click range extension (last individually-clicked tile)…
  const [anchorId, setAnchorId] = useState<number | null>(null);
  // …and whether that anchor click SELECTED (true) or DESELECTED (false), so a
  // following Shift+click paints the whole range with the same action.
  const [anchorSelecting, setAnchorSelecting] = useState(true);
  // The selection snapshot at the moment of the anchor click. Each Shift+click
  // re-derives from this baseline, so dragging the target back SHRINKS the range
  // (restoring tiles outside it) instead of leaving a painted tail behind.
  const [baseline, setBaseline] = useState<Set<number>>(new Set());

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
      const from = anchorId;
      // Shift+click: re-derive the selection from the anchor-click baseline, then
      // paint the range [anchor, target] with the anchor's action (select OR
      // deselect). Re-deriving each time means moving the target back toward the
      // anchor SHRINKS the range and dragging past it FLIPS direction — the
      // Finder / Google-Photos model — and it works for clearing a range too.
      // Computed over the flat sort order so it's predictable across day/folder
      // grouping; the anchor + its action persist so the range stays re-stretchable.
      if (mods.shift && from != null && indexById.has(from) && indexById.has(id)) {
        const a = indexById.get(from)!;
        const b = indexById.get(id)!;
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const next = new Set(baseline);
        for (let i = lo; i <= hi; i++) {
          const pid = photos[i].id;
          if (anchorSelecting) next.add(pid);
          else next.delete(pid);
        }
        setSelected(next);
        return;
      }
      // Plain / Ctrl / Cmd click: toggle the single tile, then snapshot it as the
      // new baseline and record the anchor + whether this click selected it.
      const next = new Set(selected);
      let selecting: boolean;
      if (next.has(id)) {
        next.delete(id);
        selecting = false;
      } else {
        next.add(id);
        selecting = true;
      }
      setSelected(next);
      setBaseline(next);
      setAnchorId(id);
      setAnchorSelecting(selecting);
    },
    [anchorId, anchorSelecting, baseline, indexById, photos, selected],
  );

  const selectAll = useCallback(() => {
    const all = new Set(photos.map((p) => p.id));
    setSelected(all);
    setBaseline(all);
    setAnchorId(null);
  }, [photos]);

  const clear = useCallback(() => {
    setSelected(new Set());
    setBaseline(new Set());
    setAnchorId(null);
    setAnchorSelecting(true);
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
