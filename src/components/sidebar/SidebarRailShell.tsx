'use client';

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';

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
  /** Events that trigger a full query invalidation. */
  refreshEvents?: string[];

  selectedId: number | null;
  selectedRow?: TRow | null;
  limit?: number;

  eyebrowTitle: string;
  eyebrowSuffix?: string;
  emptyText?: string;

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
  queryKey, fetchFn, updateEvent, refreshEvents,
  selectedId, selectedRow = null, limit = 25,
  eyebrowTitle, eyebrowSuffix, emptyText = 'No recent activity yet.',
  getId, getGroupId, getActivityAt, onSelect, getStatusDot,
  renderRowMain, renderPopover,
}: SidebarRailShellProps<TRow>) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<TRow[]>({
    queryKey,
    queryFn: fetchFn,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  const [localRows, setLocalRows] = useState<TRow[] | null>(null);
  useEffect(() => { if (data) setLocalRows(data); }, [data]);

  useEffect(() => {
    if (!updateEvent) return;
    const handlePatch = (event: Event) => {
      const updated = (event as CustomEvent<{ id?: number } & Partial<TRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setLocalRows((rows) => {
        if (!rows) return rows;
        const idx = rows.findIndex((r) => getId(r) === updated.id);
        if (idx < 0) return rows;
        const next = rows.slice();
        next[idx] = { ...next[idx], ...updated } as TRow;
        return next;
      });
    };
    window.addEventListener(updateEvent, handlePatch);
    return () => window.removeEventListener(updateEvent, handlePatch);
  }, [updateEvent, getId]);

  useEffect(() => {
    if (!refreshEvents || refreshEvents.length === 0) return;
    const handler = () => { queryClient.invalidateQueries({ queryKey }); };
    refreshEvents.forEach((ev) => window.addEventListener(ev, handler));
    return () => { refreshEvents.forEach((ev) => window.removeEventListener(ev, handler)); };
  }, [queryClient, queryKey, refreshEvents]);

  const allRows = localRows ?? [];
  const rows = useMemo(() => {
    const top = allRows.slice(0, limit);
    if (selectedId == null) return top;
    if (top.some((r) => getId(r) === selectedId)) return top;
    const fromDataset = allRows.find((r) => getId(r) === selectedId);
    const pin = fromDataset ?? selectedRow;
    if (!pin || getId(pin) !== selectedId) return top;
    return [pin, ...top];
  }, [allRows, limit, selectedId, selectedRow, getId]);

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
      const sameGroup = curr != null && prev != null && prevG != null && prevG === currG;
      if (!sameGroup) {
        const size = i - runStart;
        const gid = rows[runStart] != null ? getGroupId(rows[runStart]) : null;
        for (let j = runStart; j < i; j++) info[j] = { groupSize: size, groupIndex: j - runStart, groupId: gid };
        runStart = i;
      }
    }
    return info;
  }, [rows, getGroupId]);

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

  const focusRow = useCallback((idx: number) => {
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-rail-row]')[idx];
    if (btn) btn.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLUListElement>) => {
    if (rows.length === 0) return;
    const move = (next: number) => { setFocusIndex(next); focusRow(next); onSelect(rows[next]); };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(focusIndex < 0 ? 0 : Math.min(focusIndex + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(focusIndex < 0 ? 0 : Math.max(focusIndex - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(rows.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && focusIndex >= 0 && focusIndex < rows.length) { e.preventDefault(); onSelect(rows[focusIndex]); }
  }, [rows, focusIndex, focusRow, onSelect]);

  return (
    <section className="border-t border-gray-100 bg-white">
      <div className="flex items-center justify-between px-3 py-1">
        <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
          {eyebrowTitle} · {rows.length}
          {allRows.length > rows.length ? (
            <span className="ml-1 font-bold text-gray-300">/ {allRows.length}</span>
          ) : null}
        </p>
        {eyebrowSuffix && (
          <p className="text-[8.5px] font-bold uppercase tracking-widest text-gray-300">{eyebrowSuffix}</p>
        )}
      </div>
      {isLoading && rows.length === 0 ? (
        <div className="space-y-1 px-3 py-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 w-full animate-pulse rounded-md bg-gray-100" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-micro font-semibold text-gray-400">{emptyText}</p>
      ) : (
        <ul
          ref={listRef}
          className="px-2 py-1 outline-none"
          role="listbox"
          aria-label={`${eyebrowTitle} activity`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <AnimatePresence initial={false}>
            {rows.flatMap((row, idx) => {
              const g = grouped[idx];
              const isCollapsed = g.groupId != null && collapsedGroups.has(g.groupId);
              if (isCollapsed && g.groupIndex > 0) return [];
              const isLeaderOfMulti = g.groupSize > 1 && g.groupIndex === 0 && g.groupId != null;
              const showExpandedHeader = isLeaderOfMulti && !isCollapsed;
              const nodes: React.ReactElement[] = [];
              if (showExpandedHeader) {
                nodes.push(
                  <PkgGroupHeader key={`pkg-${g.groupId}`} groupSize={g.groupSize} isCollapsed={false} onToggle={() => toggleGroup(g.groupId as number)} />,
                );
              }
              nodes.push(
                <RailRow
                  key={getId(row)}
                  row={row}
                  isSelected={getId(row) === selectedId}
                  isFocused={idx === focusIndex}
                  groupSize={g.groupSize}
                  groupIndex={g.groupIndex}
                  isCollapsed={isCollapsed}
                  showInlinePkgChip={isLeaderOfMulti && isCollapsed}
                  onToggleGroup={isLeaderOfMulti ? () => toggleGroup(g.groupId as number) : undefined}
                  getStatusDot={getStatusDot}
                  getActivityAt={getActivityAt}
                  renderRowMain={renderRowMain}
                  renderPopover={renderPopover}
                  onClick={() => { setFocusIndex(idx); onSelect(row); }}
                />,
              );
              return nodes;
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function RailRow<TRow>({
  row, isSelected, isFocused, groupSize, groupIndex, isCollapsed, showInlinePkgChip,
  onToggleGroup, getStatusDot, getActivityAt, renderRowMain, renderPopover, onClick,
}: {
  row: TRow;
  isSelected: boolean;
  isFocused: boolean;
  groupSize: number;
  groupIndex: number;
  isCollapsed: boolean;
  showInlinePkgChip: boolean;
  onToggleGroup?: () => void;
  getStatusDot: (row: TRow) => string;
  getActivityAt?: (row: TRow) => string | null | undefined;
  renderRowMain: (row: TRow, ctx: SidebarRailRowContext) => ReactNode;
  renderPopover?: (row: TRow, ctx: { groupSize: number; openWorkspace: () => void; dismiss: () => void }) => ReactNode;
  onClick: () => void;
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
    if (!renderPopover) return;
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (previewOpen || openTimer.current) return;
    openTimer.current = window.setTimeout(() => { openTimer.current = null; setPreviewOpen(true); }, 200);
  }, [previewOpen, renderPopover]);

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

  return (
    <motion.li
      ref={rowRef}
      role="option"
      aria-selected={isSelected}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
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
        tabIndex={-1}
        onClick={onClick}
        className={`relative flex w-full gap-2.5 text-left transition-colors ${isGrouped ? 'pl-3 pr-2' : 'px-2'} ${
          isSelected
            ? 'items-center rounded-xl border border-blue-400 bg-blue-50 py-2.5'
            : `items-center rounded-md py-1.5 ${isFocused ? 'bg-gray-50 ring-1 ring-inset ring-gray-200' : 'hover:bg-gray-50'}`
        }`}
      >
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

function PkgGroupHeader({ groupSize, isCollapsed, onToggle }: { groupSize: number; isCollapsed: boolean; onToggle: () => void }) {
  return (
    <motion.li
      role="presentation"
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
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
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH, zIndex: 9999 }}
      className="rounded-xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
