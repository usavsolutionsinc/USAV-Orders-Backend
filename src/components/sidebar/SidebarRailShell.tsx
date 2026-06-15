'use client';

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Pencil } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { useRailEditMode } from '@/components/sidebar/rail-edit-mode';
import { staggerRevealContainer, staggerRevealItem } from '@/design-system/primitives/StaggerReveal';
import { zIndex as zLayer } from '@/design-system/tokens/z-index';

/**
 * Generic sidebar "recent activity" rail skeleton. Owns the reusable shell —
 * data fetch, optimistic patch, query invalidation, top-N + pinned-selection,
 * package grouping, keyboard nav, and the hover-preview popover positioning —
 * and pushes all domain-specific rendering out to render-prop slots.
 *
 * Receiving/Testing consume this via RecentActivityRailBase (which supplies the
 * ReceivingLineRow renderers); FBA supplies its own row + popover content.
 */

export function railRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

/** DESC sort key for a feed's `getActivityAt` axis; missing/invalid → 0 (last). */
function railActivitySortMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export interface SidebarRailRowContext {
  isSelected: boolean;
  isFocused: boolean;
  /** PKG-group chip node (when this row leads a collapsed multi-item group), else null. */
  pkgChip: ReactNode;
}

export interface SidebarRailShellProps<TRow> {
  /** React-query key. */
  queryKey: ReadonlyArray<unknown>;
  /** Fetcher returning the rows directly. */
  fetchFn: () => Promise<TRow[]>;
  /** Optimistic update event ({ id, ...partial }); merged into the matching row. */
  updateEvent?: string;
  /** Optimistic delete event ({ id }); the matching row is dropped immediately. */
  deleteEvent?: string;
  /**
   * Optimistic group-delete event (detail = group id, e.g. a receiving_id).
   * Every row whose `getGroupId` matches is dropped immediately — used when a
   * whole carton/log is removed and all its lines should vanish from the rail.
   */
  deleteGroupEvent?: string;
  /** Events that trigger a full query invalidation. */
  refreshEvents?: string[];
  /**
   * When set, a CustomEvent<'prev' | 'next'> on this name steps the selection to
   * the adjacent rendered row and fires `onSelect` — the wiring behind a detail
   * pane's up/down header chevrons when there's no separate table to drive
   * navigation (the Testing workspace has only this rail, not a history table).
   */
  navigateEvent?: string;

  selectedId: number | null;
  selectedRow?: TRow | null;
  limit?: number;

  eyebrowTitle: string;
  eyebrowSuffix?: string;
  /** Right-aligned eyebrow slot (e.g. a refresh button). Takes precedence over `eyebrowSuffix`. */
  eyebrowAction?: ReactNode;
  emptyText?: string;
  /**
   * When true, selects the first row once data loads if nothing is selected yet.
   * Re-selects when selection is cleared (e.g. switching back to Receive mode).
   */
  autoSelectFirstWhenEmpty?: boolean;
  /** Optional guard — return false to skip auto-select (deep links, wrong mode). */
  canAutoSelectFirst?: () => boolean;
  /**
   * When true, rows cascade in (stagger reveal) the first time the feed loads,
   * and freshly-arriving rows slide in individually. Off by default so callers
   * opt in explicitly.
   */
  staggerReveal?: boolean;

  getId: (row: TRow) => number;
  /** Grouping key (e.g. receiving_id). Return null for no grouping. */
  getGroupId?: (row: TRow) => number | null;
  getActivityAt?: (row: TRow) => string | null | undefined;
  onSelect: (row: TRow) => void;
  getStatusDot: (row: TRow) => string;

  renderRowMain: (row: TRow, ctx: SidebarRailRowContext) => ReactNode;
  renderPopover?: (
    row: TRow,
    ctx: { groupSize: number; openWorkspace: () => void; dismiss: () => void },
  ) => ReactNode;
}

export function SidebarRailShell<TRow>({
  queryKey, fetchFn, updateEvent, deleteEvent, deleteGroupEvent, refreshEvents, navigateEvent,
  selectedId, selectedRow = null, limit = 25,
  eyebrowTitle, eyebrowSuffix, eyebrowAction, emptyText = 'No recent activity yet.',
  autoSelectFirstWhenEmpty = false,
  canAutoSelectFirst,
  staggerReveal = false,
  getId, getGroupId, getActivityAt, onSelect, getStatusDot,
  renderRowMain, renderPopover,
}: SidebarRailShellProps<TRow>) {
  const queryClient = useQueryClient();
  // Pencil-toggle multi-select (provided by the owning panel; inactive default
  // when no provider). While active, row clicks toggle checkboxes instead of
  // opening the workspace.
  const editMode = useRailEditMode();
  // Shift-select anchor: the id of the last row whose checkbox was toggled by a
  // plain click. A shift-click then applies the clicked row's NEW state to the
  // whole visible range between anchor and click (Gmail-style). Anchored by id,
  // not index, so live feed reordering can't silently shift the range.
  const editAnchorIdRef = useRef<number | null>(null);
  useEffect(() => { editAnchorIdRef.current = null; }, [editMode.active]);

  const { data, isLoading } = useQuery<TRow[]>({
    queryKey,
    queryFn: fetchFn,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  const sortRowsByActivity = useCallback((rows: TRow[]): TRow[] => {
    if (!getActivityAt) return rows;
    return [...rows].sort((a, b) => {
      const d = railActivitySortMs(getActivityAt(b)) - railActivitySortMs(getActivityAt(a));
      return d !== 0 ? d : getId(b) - getId(a);
    });
  }, [getActivityAt, getId]);

  const [localRows, setLocalRows] = useState<TRow[] | null>(null);
  // Mirror query data, but ALSO clear to null when the active query has no array
  // data — i.e. a queryKey switch (e.g. tester A → tester B) where data is briefly
  // undefined, or an error. Without the clear, the mirror keeps the previous
  // feed's rows and renders them under the new feed's label with no skeleton.
  useEffect(() => {
    setLocalRows(Array.isArray(data) ? sortRowsByActivity(data) : null);
  }, [data, sortRowsByActivity]);

  useEffect(() => {
    if (!updateEvent) return;
    const handlePatch = (event: Event) => {
      const updated = (event as CustomEvent<{ id?: number } & Partial<TRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setLocalRows((rows) => {
        if (!rows) return rows;
        const idx = rows.findIndex((r) => getId(r) === updated.id);
        if (idx < 0) return rows;
        const existing = rows[idx];
        const merged = { ...existing, ...updated } as TRow;
        const prevMs = getActivityAt ? railActivitySortMs(getActivityAt(existing)) : 0;
        const nextMs = getActivityAt ? railActivitySortMs(getActivityAt(merged)) : prevMs;
        const next = rows.slice();
        next[idx] = merged;
        // Re-sort only when the feed's activity axis actually moved — partial
        // by-id refreshes must not shuffle rows that still share the same stamp.
        return nextMs !== prevMs ? sortRowsByActivity(next) : next;
      });
    };
    window.addEventListener(updateEvent, handlePatch);
    return () => window.removeEventListener(updateEvent, handlePatch);
  }, [updateEvent, getId, sortRowsByActivity]);

  // Ids removed via `deleteEvent`/`deleteGroupEvent`. These MUST outlive the
  // refetch: `usav-refresh-data` invalidates the query right after a delete, but
  // that refetch can race the server (eventually-consistent read / GET cache not
  // yet evicted for this view) and hand back the just-deleted rows. The
  // data-mirror effect would then write them straight back into `localRows`. So
  // we keep a sticky suppression set and filter against it in `allRows`/the pin
  // below — display stays correct no matter what the refetch returns. Receiving
  // ids/receiving_ids are monotonic DB serials (never reused), so suppressing
  // for the lifetime of the mounted rail is safe; the set resets on remount.
  // Events only fire on a CONFIRMED server delete, so a suppressed id is never a
  // false positive.
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [deletedGroupIds, setDeletedGroupIds] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    if (!deleteEvent) return;
    const handleDelete = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: number }>).detail;
      if (!detail || typeof detail.id !== 'number') return;
      const id = detail.id;
      setLocalRows((rows) => (rows ? rows.filter((r) => getId(r) !== id) : rows));
      setDeletedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    };
    window.addEventListener(deleteEvent, handleDelete);
    return () => window.removeEventListener(deleteEvent, handleDelete);
  }, [deleteEvent, getId]);

  // Whole-carton delete: drop every row sharing the removed group id at once.
  // Carries the group id (e.g. receiving_id) as a bare-number detail, so a
  // carton removed from the detail panel clears all its lines from the rail
  // immediately instead of waiting for the refetch.
  useEffect(() => {
    if (!deleteGroupEvent || !getGroupId) return;
    const handleGroupDelete = (event: Event) => {
      const groupId = Number((event as CustomEvent<unknown>).detail);
      if (!Number.isFinite(groupId)) return;
      setLocalRows((rows) => (rows ? rows.filter((r) => getGroupId(r) !== groupId) : rows));
      setDeletedGroupIds((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));
    };
    window.addEventListener(deleteGroupEvent, handleGroupDelete);
    return () => window.removeEventListener(deleteGroupEvent, handleGroupDelete);
  }, [deleteGroupEvent, getGroupId]);

  useEffect(() => {
    if (!refreshEvents || refreshEvents.length === 0) return;
    const handler = () => { queryClient.invalidateQueries({ queryKey }); };
    refreshEvents.forEach((ev) => window.addEventListener(ev, handler));
    return () => { refreshEvents.forEach((ev) => window.removeEventListener(ev, handler)); };
  }, [queryClient, queryKey, refreshEvents]);

  // Defensive: a queryKey collision (another useQuery caching a different shape
  // under the same key) can hand us a non-array `data`. Never let that crash
  // the whole sidebar — coerce to [] and render empty instead.
  const isRowDeleted = useCallback(
    (r: TRow) => {
      if (deletedIds.has(getId(r))) return true;
      if (getGroupId) {
        const g = getGroupId(r);
        if (g != null && deletedGroupIds.has(g)) return true;
      }
      return false;
    },
    [deletedIds, deletedGroupIds, getId, getGroupId],
  );
  const allRows = (Array.isArray(localRows) ? localRows : []).filter(
    (r) => !isRowDeleted(r),
  );
  // `pinnedLead` marks that rows[0] is a selected row hoisted in from beyond the
  // top-N window (so the active line stays visible). `topCount` is the count of
  // genuine recent rows (excludes the pin) for the eyebrow headline.
  const { rows, topCount, pinnedLead } = useMemo(() => {
    const top = allRows.slice(0, limit);
    const base = { rows: top, topCount: top.length, pinnedLead: false };
    if (selectedId == null) return base;
    // Never resurrect a just-deleted line via the pin — covers both a directly
    // deleted line and the synthetic stub of a deleted carton (whose group id is
    // suppressed even though its negative stub id never hit `deletedIds`).
    if (deletedIds.has(selectedId)) return base;
    if (top.some((r) => getId(r) === selectedId)) return base;
    const fromDataset = allRows.find((r) => getId(r) === selectedId);
    const pin = fromDataset ?? selectedRow;
    if (!pin || getId(pin) !== selectedId) return base;
    if (isRowDeleted(pin)) return base;
    return { rows: [pin, ...top], topCount: top.length, pinnedLead: true };
  }, [allRows, limit, selectedId, selectedRow, getId, deletedIds, isRowDeleted]);

  const grouped = useMemo(() => {
    type Info = { groupSize: number; groupIndex: number; groupId: number | null };
    const info: Info[] = rows.map(() => ({ groupSize: 1, groupIndex: 0, groupId: null }));
    if (!getGroupId) return info;
    let runStart = 0;
    for (let i = 1; i <= rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const prevG = prev != null ? getGroupId(prev) : null;
      const currG = curr != null ? getGroupId(curr) : null;
      // Never merge the hoisted pin (index 0) with the row below it: its
      // adjacency is an artifact of pinning, not a real package run.
      const sameGroup = curr != null && prev != null && prevG != null && prevG === currG
        && !(pinnedLead && i === 1);
      if (!sameGroup) {
        const size = i - runStart;
        const gid = rows[runStart] != null ? getGroupId(rows[runStart]) : null;
        for (let j = runStart; j < i; j++) info[j] = { groupSize: size, groupIndex: j - runStart, groupId: gid };
        runStart = i;
      }
    }
    return info;
  }, [rows, getGroupId, pinnedLead]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const toggleGroup = useCallback((groupId: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, []);

  const listRef = useRef<HTMLUListElement | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  useEffect(() => { if (focusIndex >= rows.length) setFocusIndex(rows.length - 1); }, [rows.length, focusIndex]);

  // Row indices that actually render a button — collapsed package members render
  // nothing, so DOM button positions no longer map 1:1 to row indices. Keyboard
  // nav walks this list (skipping hidden rows) and focus targets a row by its
  // logical index via data-rail-index, not DOM position.
  const visibleIndices = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const g = grouped[i];
      const hidden = g.groupId != null && collapsedGroups.has(g.groupId) && g.groupIndex > 0;
      if (!hidden) out.push(i);
    }
    return out;
  }, [rows.length, grouped, collapsedGroups]);

  // Header chevrons (or any external prev/next source) dispatch `navigateEvent`.
  // Walks the SAME visible order keyboard nav uses (skips collapsed group
  // members) so a chevron press never lands selection on a hidden row. With
  // nothing selected yet, prev/next both open the first rendered row.
  useEffect(() => {
    if (!navigateEvent) return;
    const handler = (event: Event) => {
      const direction = (event as CustomEvent<'prev' | 'next'>).detail;
      if (direction !== 'prev' && direction !== 'next') return;
      if (visibleIndices.length === 0) return;
      const curPos = visibleIndices.findIndex((i) => getId(rows[i]) === selectedId);
      if (curPos < 0) { onSelect(rows[visibleIndices[0]]); return; }
      const nextRowIdx = visibleIndices[curPos + (direction === 'prev' ? -1 : 1)];
      if (nextRowIdx == null) return; // already at an edge — no wrap
      onSelect(rows[nextRowIdx]);
    };
    window.addEventListener(navigateEvent, handler);
    return () => window.removeEventListener(navigateEvent, handler);
  }, [navigateEvent, rows, visibleIndices, selectedId, getId, onSelect]);

  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!autoSelectFirstWhenEmpty) return;
    if (selectedId != null) {
      autoSelectedRef.current = true;
      return;
    }
    autoSelectedRef.current = false;
  }, [autoSelectFirstWhenEmpty, selectedId]);

  useEffect(() => {
    if (!autoSelectFirstWhenEmpty || autoSelectedRef.current) return;
    if (selectedId != null || isLoading || rows.length === 0) return;
    if (canAutoSelectFirst && !canAutoSelectFirst()) return;
    autoSelectedRef.current = true;
    onSelect(rows[0]);
  }, [autoSelectFirstWhenEmpty, canAutoSelectFirst, selectedId, isLoading, rows, onSelect]);

  const focusRow = useCallback((idx: number) => {
    const btn = listRef.current?.querySelector<HTMLButtonElement>(`button[data-rail-row][data-rail-index="${idx}"]`);
    if (btn) btn.focus();
  }, []);

  // Edit-mode checkbox click. A plain click toggles the row and re-anchors;
  // shift-click applies the clicked row's NEW state to every visible row
  // between the anchor and the click (the industry-standard range select).
  const handleEditClick = useCallback((idx: number, withShift: boolean) => {
    const id = getId(rows[idx]);
    const anchorId = editAnchorIdRef.current;
    if (withShift && anchorId != null && anchorId !== id) {
      const anchorPos = visibleIndices.findIndex((i) => getId(rows[i]) === anchorId);
      const clickPos = visibleIndices.indexOf(idx);
      if (anchorPos >= 0 && clickPos >= 0) {
        const [lo, hi] = anchorPos <= clickPos ? [anchorPos, clickPos] : [clickPos, anchorPos];
        const ids = visibleIndices.slice(lo, hi + 1).map((i) => getId(rows[i]));
        editMode.setMany(ids, !editMode.selectedIds.has(id));
        editAnchorIdRef.current = id;
        return;
      }
    }
    editMode.toggle(id);
    editAnchorIdRef.current = id;
  }, [rows, visibleIndices, editMode, getId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLUListElement>) => {
    if (visibleIndices.length === 0) return;
    // Arrow/Home/End move focus only (roving tabindex); selection happens on
    // Enter/Space or click. Previously every arrow keypress dispatched onSelect,
    // opening the line in the workspace on each step. In edit mode, Shift+Arrow
    // additionally extends the checked range as focus moves (standard
    // multi-select keyboarding).
    const moveTo = (rowIdx: number, extend = false) => {
      if (extend && editMode.active && rowIdx >= 0 && rowIdx < rows.length) {
        const ids = [rowIdx, focusIndex]
          .filter((i) => i >= 0 && i < rows.length)
          .map((i) => getId(rows[i]));
        editMode.setMany(ids, true);
        editAnchorIdRef.current = getId(rows[rowIdx]);
      }
      setFocusIndex(rowIdx);
      focusRow(rowIdx);
    };
    const pos = visibleIndices.indexOf(focusIndex);
    if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(pos < 0 ? visibleIndices[0] : visibleIndices[Math.min(pos + 1, visibleIndices.length - 1)], e.shiftKey); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(pos < 0 ? visibleIndices[0] : visibleIndices[Math.max(pos - 1, 0)], e.shiftKey); }
    else if (e.key === 'Home') { e.preventDefault(); moveTo(visibleIndices[0]); }
    else if (e.key === 'End') { e.preventDefault(); moveTo(visibleIndices[visibleIndices.length - 1]); }
    else if ((e.key === 'Enter' || e.key === ' ') && focusIndex >= 0 && focusIndex < rows.length) {
      e.preventDefault();
      if (editMode.active) handleEditClick(focusIndex, e.shiftKey);
      else onSelect(rows[focusIndex]);
    }
  }, [rows, visibleIndices, focusIndex, focusRow, onSelect, editMode, getId, handleEditClick]);

  return (
    <section className="border-t border-gray-100 bg-white">
      <div className={`flex items-center justify-between ${SIDEBAR_GUTTER} py-1`}>
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          {eyebrowTitle} · {topCount}
          {allRows.length > topCount ? (
            <span className="ml-1 font-bold text-gray-300">/ {allRows.length}</span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          {eyebrowAction
            ? eyebrowAction
            : eyebrowSuffix && (
                // leading-none: without it the 8.5px suffix inherits the base
                // line-height (1.5 ≈ 12.75px), taller than the 9px/lh-1.2 eyebrow
                // title — which made the suffixed rail (Unfound) ~2px taller than
                // the action-button rail (Found). Tight leading lets the title
                // govern the row height so both eyebrows align.
                <p className="text-[8.5px] font-bold uppercase leading-none tracking-widest text-gray-300">{eyebrowSuffix}</p>
              )}
          {editMode.enabled ? (
            <RailEditPencil active={editMode.active} onToggle={editMode.toggleActive} />
          ) : null}
        </div>
      </div>
      {isLoading && rows.length === 0 ? (
        <div className={`space-y-1 ${SIDEBAR_GUTTER} py-2`}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 w-full animate-pulse rounded-md bg-gray-100" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className={`${SIDEBAR_GUTTER} py-3 text-micro font-semibold text-gray-400`}>{emptyText}</p>
      ) : (
        <motion.ul
          ref={listRef}
          className={`${SIDEBAR_GUTTER} py-1 outline-none`}
          role="listbox"
          aria-label={`${eyebrowTitle} activity`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          {...(staggerReveal
            ? { initial: 'hidden' as const, animate: 'show' as const, variants: staggerRevealContainer() }
            : {})}
        >
          {/* `initial` enabled only for the reveal so the first-load cascade plays;
              otherwise AnimatePresence suppresses the initial mount animation. */}
          <AnimatePresence initial={staggerReveal}>
            {rows.flatMap((row, idx) => {
              const g = grouped[idx];
              const isCollapsed = g.groupId != null && collapsedGroups.has(g.groupId);
              if (isCollapsed && g.groupIndex > 0) return [];
              const isLeaderOfMulti = g.groupSize > 1 && g.groupIndex === 0 && g.groupId != null;
              const showExpandedHeader = isLeaderOfMulti && !isCollapsed;
              const nodes: React.ReactElement[] = [];
              if (showExpandedHeader) {
                nodes.push(
                  <PkgGroupHeader key={`pkg-${g.groupId}`} groupSize={g.groupSize} isCollapsed={false} staggerReveal={staggerReveal} onToggle={() => toggleGroup(g.groupId as number)} />,
                );
              }
              nodes.push(
                <RailRow
                  key={getId(row)}
                  row={row}
                  index={idx}
                  staggerReveal={staggerReveal}
                  isSelected={getId(row) === selectedId}
                  isFocused={idx === focusIndex}
                  editActive={editMode.active}
                  isChecked={editMode.active && editMode.selectedIds.has(getId(row))}
                  groupSize={g.groupSize}
                  groupIndex={g.groupIndex}
                  isCollapsed={isCollapsed}
                  showInlinePkgChip={isLeaderOfMulti && isCollapsed}
                  onToggleGroup={isLeaderOfMulti ? () => toggleGroup(g.groupId as number) : undefined}
                  getStatusDot={getStatusDot}
                  getActivityAt={getActivityAt}
                  renderRowMain={renderRowMain}
                  renderPopover={renderPopover}
                  onClick={(e) => {
                    setFocusIndex(idx);
                    if (editMode.active) handleEditClick(idx, e?.shiftKey ?? false);
                    else onSelect(row);
                  }}
                />,
              );
              return nodes;
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </section>
  );
}

/**
 * Eyebrow pencil — flips the rail into checkbox multi-select (see
 * {@link useRailEditMode}). Eyebrow-scale sibling of actions like the Scanned
 * rail's "Sync Zoho"; active state fills blue and swaps to a ✓ ("done").
 *
 * `-my-1.5` bleeds the 20px hit box out of the row's height math (same trick
 * as the Sync Zoho pill) so every rail eyebrow keeps the identical compact
 * text-governed height whether its right slot is a suffix, an action, or this.
 */
function RailEditPencil({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? 'Done — exit select mode' : 'Select rows for bulk actions'}
      title={active ? 'Done' : 'Select rows (bulk delete)'}
      className={`-my-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
      }`}
    >
      {active ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
    </button>
  );
}

function RailRow<TRow>({
  row, index, isSelected, isFocused, editActive, isChecked, groupSize, groupIndex, isCollapsed, showInlinePkgChip,
  staggerReveal, onToggleGroup, getStatusDot, getActivityAt, renderRowMain, renderPopover, onClick,
}: {
  row: TRow;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  editActive: boolean;
  isChecked: boolean;
  groupSize: number;
  groupIndex: number;
  isCollapsed: boolean;
  showInlinePkgChip: boolean;
  staggerReveal: boolean;
  onToggleGroup?: () => void;
  getStatusDot: (row: TRow) => string;
  getActivityAt?: (row: TRow) => string | null | undefined;
  renderRowMain: (row: TRow, ctx: SidebarRailRowContext) => ReactNode;
  renderPopover?: (row: TRow, ctx: { groupSize: number; openWorkspace: () => void; dismiss: () => void }) => ReactNode;
  /** Event is absent when invoked synthetically (popover "Open →"). */
  onClick: (e?: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const isGrouped = groupSize > 1;
  const isGroupLast = isGrouped && groupIndex === groupSize - 1;
  const isLeader = isGrouped && groupIndex === 0;
  const railIsFirst = isCollapsed ? isLeader : false;
  const railIsLast = isCollapsed ? isLeader : isGroupLast;

  const rowRef = useRef<HTMLLIElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const scheduleOpen = useCallback(() => {
    // Edit mode: no hover previews — the surface is for picking rows, and the
    // popover's "Open →" CTA contradicts the click-to-check behavior.
    if (!renderPopover || editActive) return;
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (previewOpen || openTimer.current) return;
    openTimer.current = window.setTimeout(() => { openTimer.current = null; setPreviewOpen(true); }, 200);
  }, [previewOpen, renderPopover, editActive]);

  // Entering edit mode mid-hover: dismiss any preview already showing.
  useEffect(() => { if (editActive) setPreviewOpen(false); }, [editActive]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) { window.clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setPreviewOpen(false); }, 150);
  }, []);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const pkgChip = showInlinePkgChip ? (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onToggleGroup?.(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleGroup?.(); } }}
      title={`Expand — show ${groupSize - 1} more in this package`}
      aria-expanded={false}
      aria-label="Expand package"
      className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-indigo-100 px-1 py-px text-[8.5px] font-black uppercase tracking-widest text-indigo-700 transition-colors hover:bg-indigo-200"
    >
      <motion.span animate={{ rotate: -90 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} className="inline-flex">
        <ChevronDown className="h-2.5 w-2.5" />
      </motion.span>
      PKG · {groupSize}
      <span className="ml-0.5 text-indigo-500/80">·</span>
      <span className="text-indigo-500/80">+{groupSize - 1}</span>
    </span>
  ) : null;

  const activityAt = getActivityAt?.(row);

  // Stagger mode: inherit the parent <ul>'s hidden→show timeline via variants
  // (exit lives in the variant too). Default mode: opacity-only enter/exit with
  // no initial mount animation, as before.
  const motionProps = staggerReveal
    ? { variants: staggerRevealItem }
    : { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12, ease: [0.22, 1, 0.36, 1] as const } };

  return (
    <motion.li
      ref={rowRef}
      role="option"
      aria-selected={editActive ? isChecked : isSelected}
      {...motionProps}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      {isGrouped ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 z-10 w-[2px] bg-indigo-300 ${
            railIsFirst
              ? railIsLast ? 'top-1.5 bottom-1.5 rounded-full' : 'top-1.5 bottom-0 rounded-t-full'
              : railIsLast ? 'top-0 bottom-1.5 rounded-b-full' : 'inset-y-0'
          }`}
        />
      ) : null}
      <button
        type="button"
        data-rail-row
        data-rail-index={index}
        tabIndex={-1}
        onClick={onClick}
        // Shift-click range select: stop the browser's native shift-click text
        // selection from highlighting row labels across the range.
        onMouseDown={(e) => { if (editActive && e.shiftKey) e.preventDefault(); }}
        className={`relative flex w-full gap-2.5 text-left transition-colors ${isGrouped ? 'pl-3 pr-2' : 'px-2'} ${
          (editActive ? isChecked : isSelected)
            ? 'items-center rounded-md bg-blue-50 ring-1 ring-inset ring-blue-400 py-1.5'
            : `items-center rounded-md py-1.5 ${isFocused ? 'bg-gray-50 ring-1 ring-inset ring-gray-200' : 'hover:bg-gray-50'}`
        }`}
      >
        {editActive ? (
          <span
            aria-hidden
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
              isChecked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
            }`}
          >
            {isChecked ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
        ) : null}
        <span className={`h-2 w-2 shrink-0 rounded-full ${getStatusDot(row)}`} aria-hidden />
        <div className="min-w-0 flex-1">
          {renderRowMain(row, { isSelected, isFocused, pkgChip })}
        </div>
        {activityAt != null ? (
          <span className="shrink-0 self-center tabular-nums text-micro font-medium text-gray-400">
            {railRelativeTime(activityAt)}
          </span>
        ) : null}
      </button>
      <AnimatePresence>
        {previewOpen && renderPopover ? (
          <RailPopover anchorEl={rowRef.current} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} onDismiss={() => setPreviewOpen(false)}>
            {renderPopover(row, { groupSize, openWorkspace: onClick, dismiss: () => setPreviewOpen(false) })}
          </RailPopover>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

function PkgGroupHeader({ groupSize, isCollapsed, staggerReveal, onToggle }: { groupSize: number; isCollapsed: boolean; staggerReveal: boolean; onToggle: () => void }) {
  const motionProps = staggerReveal
    ? { variants: staggerRevealItem }
    : { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    <motion.li
      role="presentation"
      {...motionProps}
      className="relative"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Expand package' : 'Collapse package'}
        className="flex w-full items-center gap-1.5 rounded-t-md border-t border-x border-indigo-200/70 bg-indigo-50/80 pl-3 pr-2 py-1 text-left text-indigo-700 transition-colors hover:bg-indigo-100/80"
      >
        <motion.span animate={{ rotate: isCollapsed ? -90 : 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} className="inline-flex">
          <ChevronDown className="h-3 w-3" />
        </motion.span>
        <span className="text-[8.5px] font-black uppercase tracking-widest">PKG · {groupSize}</span>
        <span className="ml-auto text-[8.5px] font-bold uppercase tracking-widest text-indigo-400">{groupSize} items</span>
      </button>
    </motion.li>
  );
}

/**
 * Generic hover-preview popover positioning wrapper. Handles portal, viewport
 * flipping, resize/scroll reflow, and Escape-to-dismiss. Content is supplied
 * by the caller via children.
 */
export function RailPopover({
  anchorEl, onMouseEnter, onMouseLeave, onDismiss, children,
}: {
  anchorEl: HTMLElement | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const POPOVER_WIDTH = 320;
  const POPOVER_FALLBACK_HEIGHT = 440;
  const VIEWPORT_PADDING = 8;
  const GAP = 10;
  const [coords, setCoords] = useState<{ left: number; top: number; flipped: boolean } | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const measurePosition = useCallback(() => {
    if (!anchorEl) return null;
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const flipped = vw - rect.right < POPOVER_WIDTH + GAP + 12;
    const left = flipped
      ? Math.max(VIEWPORT_PADDING, rect.left - POPOVER_WIDTH - GAP)
      : Math.min(vw - POPOVER_WIDTH - VIEWPORT_PADDING, rect.right + GAP);
    const popH = popoverRef.current?.getBoundingClientRect().height ?? POPOVER_FALLBACK_HEIGHT;
    const maxTop = Math.max(VIEWPORT_PADDING, vh - popH - VIEWPORT_PADDING);
    const top = Math.max(VIEWPORT_PADDING, Math.min(rect.top, maxTop));
    return { left, top, flipped };
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const apply = () => { const next = measurePosition(); if (next) setCoords(next); };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => { window.removeEventListener('resize', apply); window.removeEventListener('scroll', apply, true); };
  }, [anchorEl, measurePosition]);

  const previewVisible = coords !== null;
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!anchorEl || !previewVisible || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const next = measurePosition(); if (next) setCoords(next); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchorEl, previewVisible, measurePosition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (typeof document === 'undefined' || !coords) return null;

  return createPortal(
    <motion.div
      ref={popoverRef}
      role="dialog"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      initial={{ opacity: 0, x: coords.flipped ? 8 : -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: coords.flipped ? 8 : -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.6 }}
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH, zIndex: zLayer.panelPopover }}
      className="rounded-xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
