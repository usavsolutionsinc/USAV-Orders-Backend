'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emitSelection,
  emitSelectionTotal,
  onToggleAll,
} from '@/lib/selection/table-selection';

/**
 * Table-side wiring for the pencil "Select → pick rows → act" flow, factored
 * out of {@link ReceivingLinesTable} so any list can opt in with one call.
 *
 * Owns the checked-id set and:
 *   • broadcasts the resolved selected rows on `scope` (for useTableSelection),
 *   • mirrors the header Select-all / Clear toggle (onToggleAll),
 *   • publishes the selectable total so the action bar's ring can fill,
 *   • clears the selection when select mode turns off.
 *
 * The owning page renders the pencil (usePageSelection) and the
 * <ContextualSelectionBar>; the table just calls this with its visible rows.
 *
 * `rows` / `getId` are read through refs so the broadcast fires only when the
 * *selection* changes — not on every parent re-render. That matters because the
 * page collects the broadcast into React state (useTableSelection); re-emitting
 * on each render would ping-pong page → table → page in a loop. Callers
 * therefore need NOT memoize `rows`.
 */
export function useTableSelectMode<T>({
  scope,
  selectMode,
  rows,
  getId,
}: {
  /** Shared with the page's useTableSelection + the action bar. */
  scope: string;
  /** True while the pencil toggle is on — rows render checkboxes. */
  selectMode: boolean;
  /** Visible rows in render order — drives Select-all + the broadcast payload. */
  rows: T[];
  /** Row → stable numeric id (the checkbox key). */
  getId: (row: T) => number;
}): {
  selectedIds: ReadonlySet<number>;
  /** Toggle one row. Pass `extend` (shift-click) to apply the clicked row's NEW
   *  state to every visible row between the last-clicked anchor and this one. */
  toggle: (id: number, extend?: boolean) => void;
  isSelected: (id: number) => boolean;
} {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Latest rows / id-accessor, read at emit time so the effects below don't
  // have to depend on `rows` identity (see the loop note in the docblock).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  // Last-clicked row id — the anchor for shift-click range select.
  const anchorRef = useRef<number | null>(null);

  const toggle = useCallback((id: number, extend = false) => {
    const anchorId = anchorRef.current;
    if (extend && anchorId != null && anchorId !== id) {
      const ids = rowsRef.current.map((r) => getIdRef.current(r));
      const anchorPos = ids.indexOf(anchorId);
      const clickPos = ids.indexOf(id);
      if (anchorPos >= 0 && clickPos >= 0) {
        const [lo, hi] = anchorPos <= clickPos ? [anchorPos, clickPos] : [clickPos, anchorPos];
        const range = ids.slice(lo, hi + 1);
        setSelectedIds((prev) => {
          // Apply the clicked row's NEW state to the whole range (range select).
          const checked = !prev.has(id);
          const next = new Set(prev);
          for (const rid of range) {
            if (checked) next.add(rid);
            else next.delete(rid);
          }
          return next;
        });
        anchorRef.current = id;
        return;
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  }, []);

  const isSelected = useCallback((id: number) => selectedIds.has(id), [selectedIds]);

  // Broadcast the resolved selected rows whenever the checked set changes.
  useEffect(() => {
    if (!selectMode) return;
    const byId = new Map(rowsRef.current.map((r) => [getIdRef.current(r), r] as const));
    const out: T[] = [];
    for (const id of selectedIds) {
      const row = byId.get(id);
      if (row) out.push(row);
    }
    emitSelection(scope, out);
  }, [scope, selectMode, selectedIds]);

  // Leaving select mode clears the selection (and notifies listeners).
  useEffect(() => {
    if (selectMode) return;
    anchorRef.current = null;
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
    emitSelection(scope, []);
  }, [scope, selectMode]);

  // Header "Select all" / "Clear" → toggle every currently-visible row.
  useEffect(() => {
    return onToggleAll(scope, (mode) => {
      if (mode !== 'all') anchorRef.current = null;
      setSelectedIds(
        mode === 'all'
          ? new Set(rowsRef.current.map((r) => getIdRef.current(r)))
          : new Set(),
      );
    });
  }, [scope]);

  // Publish the selectable total so the action bar's select-all ring can fill.
  // Zero outside select mode so a stale "all selected" never lingers.
  useEffect(() => {
    emitSelectionTotal(scope, selectMode ? rows.length : 0);
  }, [scope, selectMode, rows.length]);

  return { selectedIds, toggle, isSelected };
}
