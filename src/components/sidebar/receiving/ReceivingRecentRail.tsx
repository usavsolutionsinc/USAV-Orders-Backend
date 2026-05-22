'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { Camera, ChevronDown } from '@/components/Icons';
import { conditionGradeTableLabel, workflowStatusTableLabel, WORKFLOW_BADGE } from '@/components/station/receiving-constants';
import {
  OrderIdChip,
  TrackingChip,
  SkuScanRefChip,
  SerialChip,
  getLast4,
  getLast6Serial,
} from '@/components/ui/CopyChip';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
}

function relativeTime(iso: string | null | undefined): string {
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

function getStatusDot(
  status: string | null | undefined,
  qtyReceived?: number,
  qtyExpected?: number | null,
): string {
  if (
    qtyExpected != null &&
    qtyExpected > 0 &&
    qtyReceived != null &&
    qtyReceived >= qtyExpected
  ) {
    return 'bg-emerald-500';
  }
  const v = String(status || '').trim().toUpperCase();
  if (v === 'EXPECTED') return 'bg-amber-400';
  if (v === 'ARRIVED' || v === 'MATCHED') return 'bg-blue-500';
  if (v === 'UNBOXED') return 'bg-indigo-500';
  if (v === 'AWAITING_TEST' || v === 'IN_TEST') return 'bg-violet-500';
  if (v === 'PASSED' || v === 'DONE') return 'bg-emerald-500';
  if (v.startsWith('FAILED') || v === 'SCRAP' || v === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
}

interface Props {
  /** Currently selected line id — gets a highlight ring so the rail mirrors the workspace. */
  selectedLineId: number | null;
  /** Cap on rendered rows; the underlying query still pulls the full table page. */
  limit?: number;
}

/**
 * Sidebar "Recent activity" rail — shares the exact data source the History
 * table uses (`view=all`, queryKey `['receiving-lines-table', 'all']`) so
 * both surfaces stay in lockstep without a second fetch. Renders the first
 * `limit` rows of the same dataset; clicking a row dispatches
 * `receiving-select-line` → opens it in the workspace.
 *
 * Listens to `receiving-line-updated` for optimistic patches of an existing
 * row, plus `usav-refresh-data` / `receiving-entry-added` for invalidation
 * so it acts as an ambient feed while the operator works.
 */
export function ReceivingRecentRail({ selectedLineId, limit = 20 }: Props) {
  const queryClient = useQueryClient();
  // Match `ReceivingLinesTable`'s queryKey + queryFn exactly so react-query
  // dedupes the fetch — the rail rides on the table's cache.
  const queryKey = useMemo(() => ['receiving-lines-table', 'all'] as const, []);

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', offset: '0' });
      params.set('include', 'serials');
      params.set('view', 'all');
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  // Local optimistic mirror — merges receiving-line-updated patches into the
  // cached list without a full refetch. This keeps the rail visibly live as
  // the operator works on a line in the workspace.
  const [localRows, setLocalRows] = useState<ReceivingLineRow[] | null>(null);
  useEffect(() => {
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data]);

  useEffect(() => {
    const handlePatch = (event: Event) => {
      const updated = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!updated || typeof updated.id !== 'number') return;
      setLocalRows((rows) => {
        if (!rows) return rows;
        const idx = rows.findIndex((r) => r.id === updated.id);
        if (idx < 0) return rows;
        const next = rows.slice();
        next[idx] = { ...next[idx], ...updated } as ReceivingLineRow;
        return next;
      });
    };
    window.addEventListener('receiving-line-updated', handlePatch);
    return () => window.removeEventListener('receiving-line-updated', handlePatch);
  }, []);

  // Whole-list refresh triggers (new scan, returning tracking match). The
  // table already listens for the same events on the same queryKey, so a
  // single invalidation refreshes both surfaces.
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
    };
    window.addEventListener('receiving-entry-added', handler);
    window.addEventListener('usav-refresh-data', handler);
    return () => {
      window.removeEventListener('receiving-entry-added', handler);
      window.removeEventListener('usav-refresh-data', handler);
    };
  }, [queryClient]);

  // The rail shows the top `limit` rows of the same dataset the History
  // table renders. They're already sorted server-side (view=all sorts by
  // most-recent activity), so slicing gives a chronological feed.
  const allRows = localRows ?? [];
  const rows = allRows.slice(0, limit);

  // Bundle grouping: adjacent rows sharing a receiving_id are part of the
  // same physical package (multi-item PO). Compute the group span per row
  // so we can render a shared left rail across the group and a "PKG · N"
  // chip on the first row. Non-adjacent rows are treated as separate hits
  // even if they share a receiving_id — keeps the visual signal honest.
  const grouped = useMemo(() => {
    type Info = { groupSize: number; groupIndex: number; groupId: number | null };
    const info: Info[] = rows.map(() => ({ groupSize: 1, groupIndex: 0, groupId: null }));
    let runStart = 0;
    for (let i = 1; i <= rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const sameGroup =
        curr != null &&
        prev != null &&
        prev.receiving_id != null &&
        prev.receiving_id === curr.receiving_id;
      if (!sameGroup) {
        const size = i - runStart;
        const gid = rows[runStart]?.receiving_id ?? null;
        for (let j = runStart; j < i; j++) {
          info[j] = { groupSize: size, groupIndex: j - runStart, groupId: gid };
        }
        runStart = i;
      }
    }
    return info;
  }, [rows]);

  // Per-group collapsed state (ephemeral, in-component). Groups default to
  // expanded so the rail still surfaces every line; clicking the chevron
  // on the leader row collapses the bundle to a single summary line.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const toggleGroup = useCallback((groupId: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── Keyboard navigation (roving tabindex) ──────────────────────────────────
  // Buttons don't natively move focus on arrow keys; we wire ArrowUp/Down
  // ourselves and dispatch select on focus so workspace mirrors the rail.
  // Focus index resets when the visible-row set changes (e.g. new scan
  // pushes the previously-focused row past the cap).
  const listRef = useRef<HTMLUListElement | null>(null);
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  useEffect(() => {
    if (focusIndex >= rows.length) setFocusIndex(rows.length - 1);
  }, [rows.length, focusIndex]);

  const focusRow = useCallback((idx: number) => {
    const ul = listRef.current;
    if (!ul) return;
    const btn = ul.querySelectorAll<HTMLButtonElement>('button[data-rail-row]')[idx];
    if (btn) btn.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLUListElement>) => {
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = focusIndex < 0 ? 0 : Math.min(focusIndex + 1, rows.length - 1);
      setFocusIndex(next);
      focusRow(next);
      dispatchSelectLine(rows[next]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = focusIndex < 0 ? 0 : Math.max(focusIndex - 1, 0);
      setFocusIndex(next);
      focusRow(next);
      dispatchSelectLine(rows[next]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIndex(0);
      focusRow(0);
      dispatchSelectLine(rows[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = rows.length - 1;
      setFocusIndex(last);
      focusRow(last);
      dispatchSelectLine(rows[last]);
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Activation: same as click on the focused row.
      if (focusIndex >= 0 && focusIndex < rows.length) {
        e.preventDefault();
        dispatchSelectLine(rows[focusIndex]);
      }
    }
  }, [rows, focusIndex, focusRow]);

  return (
    <section className="border-t border-gray-100 bg-white">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
          Recent · {rows.length}
          {allRows.length > rows.length ? (
            <span className="ml-1 font-bold text-gray-300">/ {allRows.length}</span>
          ) : null}
        </p>
        <p className="text-[8.5px] font-bold uppercase tracking-widest text-gray-300">
          Same as History
        </p>
      </div>
      {isLoading && rows.length === 0 ? (
        <div className="space-y-1 px-3 py-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded-md bg-gray-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-[10px] font-semibold text-gray-400">
          No recent activity yet.
        </p>
      ) : (
        <ul
          ref={listRef}
          className="px-2 py-1 outline-none"
          role="listbox"
          aria-label="Recent receiving lines"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <AnimatePresence initial={false}>
            {rows.flatMap((row, idx) => {
              const g = grouped[idx];
              const isCollapsed =
                g.groupId != null && collapsedGroups.has(g.groupId);
              // Skip non-leader rows when the group is collapsed; the leader
              // row carries the inline PKG · N · +M summary in their place.
              if (isCollapsed && g.groupIndex > 0) return [];

              const isLeaderOfMulti =
                g.groupSize > 1 && g.groupIndex === 0 && g.groupId != null;
              const showExpandedHeader = isLeaderOfMulti && !isCollapsed;

              const nodes: React.ReactElement[] = [];

              // Expanded state — render a thin full-width section header
              // strip BEFORE the leader row marking the start of the package.
              if (showExpandedHeader) {
                nodes.push(
                  <PkgGroupHeader
                    key={`pkg-${g.groupId}`}
                    groupSize={g.groupSize}
                    isCollapsed={false}
                    onToggle={() => toggleGroup(g.groupId as number)}
                  />,
                );
              }

              nodes.push(
                <RailRow
                  key={row.id}
                  row={row}
                  isSelected={row.id === selectedLineId}
                  isFocused={idx === focusIndex}
                  groupSize={g.groupSize}
                  groupIndex={g.groupIndex}
                  groupId={g.groupId}
                  isCollapsed={isCollapsed}
                  // Inline chip only when collapsed — keeps the leader row at
                  // the same height as singles. When expanded, the header
                  // strip above owns the toggle.
                  showInlinePkgChip={isLeaderOfMulti && isCollapsed}
                  onToggleGroup={
                    isLeaderOfMulti
                      ? () => toggleGroup(g.groupId as number)
                      : undefined
                  }
                  onClick={() => {
                    setFocusIndex(idx);
                    dispatchSelectLine(row);
                  }}
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

function RailRow({
  row,
  isSelected,
  isFocused,
  groupSize,
  groupIndex,
  groupId,
  isCollapsed,
  showInlinePkgChip,
  onToggleGroup,
  onClick,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  isFocused: boolean;
  /** Size of the contiguous same-package group this row belongs to. 1 = solo. */
  groupSize: number;
  /** Index within the group: 0 = first row, groupSize - 1 = last. */
  groupIndex: number;
  /** receiving_id shared across the contiguous group, or null when ungrouped. */
  groupId: number | null;
  /** Whether the bundle this row leads is currently collapsed. */
  isCollapsed: boolean;
  /** When true, render the inline PKG · N · +M chip in the row (collapsed leader). */
  showInlinePkgChip: boolean;
  /** Provided only for the leader of a multi-item group — toggles collapse. */
  onToggleGroup?: () => void;
  onClick: () => void;
}) {
  const isGrouped = groupSize > 1;
  const isGroupLast = isGrouped && groupIndex === groupSize - 1;
  const isLeader = isGrouped && groupIndex === 0;
  // Rail bookkeeping. When collapsed, the leader row renders as a pill
  // (rail starts and ends on it). When expanded, the rail flows from the
  // header strip above through the last child below.
  const railIsFirst = isCollapsed ? isLeader : false;
  const railIsLast = isCollapsed ? isLeader : isGroupLast;

  // Hover-preview popover state. Open after a 200ms delay so quick scrolls
  // through the list don't flash a popover for every row; close after a
  // 150ms grace so the cursor can cross the small gap between the row and
  // the popover without dismissing it.
  const rowRef = useRef<HTMLLIElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const scheduleOpen = useCallback(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (previewOpen || openTimer.current) return;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setPreviewOpen(true);
    }, 200);
  }, [previewOpen]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPreviewOpen(false);
    }, 150);
  }, []);

  useEffect(() => () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const qty = `${row.quantity_received}/${row.quantity_expected ?? '?'}`;
  const isComplete =
    row.quantity_expected != null && row.quantity_received >= row.quantity_expected;
  const techId = row.assigned_tech_id ?? null;
  const techColor = techId
    ? stationThemeColors[getStaffThemeById(techId)].text
    : 'text-gray-400';
  // Match the server's view=all sort: last scan → received_at → created_at.
  // Keeps the displayed timestamp aligned with the row order.
  const activityAt = row.last_activity_at ?? row.created_at;

  return (
    <motion.li
      ref={rowRef}
      layout
      role="option"
      aria-selected={isSelected}
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      {/* Shared left rail spanning the package's contiguous group. Rendered
          on the <li> so it visually connects across consecutive rows. When
          the leader has collapsed its bundle, the rail renders as a self-
          contained pill on the leader row alone. */}
      {isGrouped ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 z-10 w-[2px] bg-indigo-300 ${
            railIsFirst
              ? railIsLast
                ? 'top-1.5 bottom-1.5 rounded-full'
                : 'top-1.5 bottom-0 rounded-t-full'
              : railIsLast
                ? 'top-0 bottom-1.5 rounded-b-full'
                : 'inset-y-0'
          }`}
        />
      ) : null}
      <button
        type="button"
        data-rail-row
        tabIndex={-1}
        onClick={onClick}
        className={`relative flex w-full items-center gap-2 rounded-md py-1.5 text-left transition-colors ${
          isGrouped ? 'pl-3 pr-2' : 'px-2'
        } ${
          isSelected
            ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200'
            : isFocused
              ? 'bg-gray-50 ring-1 ring-inset ring-gray-200'
              : 'hover:bg-gray-50'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${getStatusDot(row.workflow_status, row.quantity_received, row.quantity_expected)}`}
          aria-hidden
          title={row.workflow_status || undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[11px] font-bold text-gray-900" title={title}>
              {title}
            </p>
            {showInlinePkgChip ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleGroup?.();
                }}
                title={`Expand — show ${groupSize - 1} more in this package`}
                aria-expanded={false}
                aria-label="Expand package"
                className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-100 px-1 py-px text-[8.5px] font-black uppercase tracking-widest text-indigo-700 transition-colors hover:bg-indigo-200"
              >
                <motion.span
                  animate={{ rotate: -90 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="inline-flex"
                >
                  <ChevronDown className="h-2.5 w-2.5" />
                </motion.span>
                PKG · {groupSize}
                <span className="ml-0.5 text-indigo-500/80">·</span>
                <span className="text-indigo-500/80">+{groupSize - 1}</span>
              </button>
            ) : null}
          </div>
          <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-gray-500">
            <span className={isComplete ? 'text-emerald-600' : 'text-gray-600'}>
              {qty}
            </span>
            {techId ? (
              <span className={`ml-1 ${techColor}`}>
                · {getStaffName(techId)}
              </span>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 tabular-nums text-[9px] font-bold text-gray-400">
          {relativeTime(activityAt)}
        </span>
      </button>
      <AnimatePresence>
        {previewOpen ? (
          <RowPreviewPopover
            row={row}
            anchorEl={rowRef.current}
            groupSize={groupSize}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onOpenWorkspace={onClick}
            onDismiss={() => setPreviewOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/**
 * Thin full-width section header that marks the top of an expanded
 * multi-item package group. Sits inside the same <ul> as the rail rows so
 * keyboard navigation flows naturally, but renders as a non-selectable strip
 * with a soft indigo background distinguishing the group from single-item
 * rows around it.
 */
function PkgGroupHeader({
  groupSize,
  isCollapsed,
  onToggle,
}: {
  groupSize: number;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.li
      layout
      role="presentation"
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Expand package' : 'Collapse package'}
        title={
          isCollapsed
            ? `Expand — show ${groupSize - 1} more in this package`
            : `Collapse — hide ${groupSize - 1} other items in this package`
        }
        className="flex w-full items-center gap-1.5 rounded-t-md border-t border-x border-indigo-200/70 bg-indigo-50/80 pl-3 pr-2 py-1 text-left text-indigo-700 transition-colors hover:bg-indigo-100/80"
      >
        <motion.span
          animate={{ rotate: isCollapsed ? -90 : 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex"
        >
          <ChevronDown className="h-3 w-3" />
        </motion.span>
        <span className="text-[8.5px] font-black uppercase tracking-widest">
          PKG · {groupSize}
        </span>
        <span className="ml-auto text-[8.5px] font-bold uppercase tracking-widest text-indigo-400">
          {groupSize} items
        </span>
      </button>
    </motion.li>
  );
}

interface RowPreviewPopoverProps {
  row: ReceivingLineRow;
  anchorEl: HTMLLIElement | null;
  groupSize: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenWorkspace: () => void;
  onDismiss: () => void;
}

/**
 * Linear-style hover preview. Rendered into a document.body portal so it
 * floats above the workspace overlay; positioned relative to the row's
 * bounding rect, flipping left when the right slot would overflow.
 */
function RowPreviewPopover({
  row,
  anchorEl,
  groupSize,
  onMouseEnter,
  onMouseLeave,
  onOpenWorkspace,
  onDismiss,
}: RowPreviewPopoverProps) {
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const qtyExpected = row.quantity_expected ?? 0;
  const isComplete = qtyExpected > 0 && row.quantity_received >= qtyExpected;
  const progressPct =
    qtyExpected > 0
      ? Math.min(100, Math.round((row.quantity_received / qtyExpected) * 100))
      : row.quantity_received > 0
        ? 100
        : 0;
  const condGrade = (row.condition_grade || '').trim().toUpperCase();
  const conditionLabel = conditionGradeTableLabel(row.condition_grade);
  const conditionTone =
    condGrade === 'BRAND_NEW'
      ? 'bg-yellow-50 text-yellow-700 ring-yellow-200'
      : condGrade === 'USED_A'
        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        : condGrade === 'USED_B'
          ? 'bg-blue-50 text-blue-700 ring-blue-200'
          : condGrade === 'USED_C'
            ? 'bg-slate-100 text-slate-700 ring-slate-300'
            : condGrade === 'PARTS'
              ? 'bg-amber-50 text-amber-700 ring-amber-200'
              : 'bg-gray-100 text-gray-500 ring-gray-200';
  const workflowLabel = workflowStatusTableLabel(row.workflow_status || 'EXPECTED');
  const workflowTone =
    WORKFLOW_BADGE[String(row.workflow_status || 'EXPECTED').toUpperCase()]
    ?? 'bg-gray-100 text-gray-600';
  const trackingValue = (row.tracking_number || '').trim();
  const skuValue = (row.sku || '').trim();
  const poValue = (row.zoho_purchaseorder_number || row.zoho_purchaseorder_id || '').trim();
  const serialsCsv = (row.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join(', ');

  // Position calculation — viewport-aware. Anchor to the row's right edge
  // with a 10px gap; flip to the left side when the popover would clip the
  // viewport right edge. Re-measured on mount + window resize so the popover
  // sticks to the row even if the sidebar reflows.
  const POPOVER_WIDTH = 320;
  const GAP = 10;
  const [coords, setCoords] = useState<{ left: number; top: number; flipped: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const measure = () => {
      const rect = anchorEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rightSpace = vw - rect.right;
      const flipped = rightSpace < POPOVER_WIDTH + GAP + 12;
      const left = flipped
        ? Math.max(8, rect.left - POPOVER_WIDTH - GAP)
        : Math.min(vw - POPOVER_WIDTH - 8, rect.right + GAP);
      // Clamp to viewport vertically so the popover doesn't sit off-screen
      // for rows near the bottom of the list.
      const desiredTop = rect.top;
      const top = Math.min(Math.max(8, desiredTop), vh - 80);
      setCoords({ left, top, flipped });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchorEl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  if (typeof document === 'undefined' || !coords) return null;

  return createPortal(
    <motion.div
      role="dialog"
      aria-label={`Preview ${title}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      initial={{ opacity: 0, x: coords.flipped ? 8 : -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: coords.flipped ? 8 : -8, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.6 }}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width: POPOVER_WIDTH,
        zIndex: 200,
      }}
      className="rounded-xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5"
    >
      <div className="space-y-3 p-3.5">
        {/* Title + status chips */}
        <div>
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[13px] font-black leading-snug text-gray-900">
              {title}
            </p>
            {groupSize > 1 ? (
              <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-indigo-700">
                PKG · {groupSize}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-inset ${conditionTone}`}>
              {conditionLabel}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${workflowTone}`}>
              {workflowLabel}
            </span>
            {row.needs_test ? (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-orange-700">
                Test
              </span>
            ) : null}
            {/* Photos badge — pinned to the right of the chip row so the
                operator can see at-a-glance whether the package has any
                visual evidence attached without opening the workspace. */}
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                (row.photo_count ?? 0) > 0
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                  : 'bg-gray-50 text-gray-400 ring-1 ring-inset ring-gray-200'
              }`}
              title={`${row.photo_count ?? 0} ${(row.photo_count ?? 0) === 1 ? 'photo' : 'photos'}`}
            >
              <Camera className="h-3 w-3" />
              {row.photo_count ?? 0}
            </span>
          </div>
        </div>

        {/* Qty progress bar */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              Received
            </span>
            <span className={`text-[11px] font-black tabular-nums ${isComplete ? 'text-emerald-600' : 'text-gray-700'}`}>
              {row.quantity_received}
              <span className="text-gray-300 mx-0.5">/</span>
              <span className="text-gray-400">{row.quantity_expected ?? '?'}</span>
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className={`h-full ${isComplete ? 'bg-emerald-500' : 'bg-blue-500'}`}
            />
          </div>
        </div>

        {/* Identifier chips — evenly distributed across the row so each chip
            sits in its own balanced slot regardless of underlying value
            length. Grid keeps cells equal-width; chips align to the start
            of their cell. */}
        <div
          className={`grid items-center gap-2 border-t border-gray-100 pt-3 ${
            serialsCsv ? 'grid-cols-4' : 'grid-cols-3'
          }`}
        >
          <OrderIdChip value={poValue} display={getLast4(poValue)} />
          <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
          <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
          {serialsCsv ? (
            <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
          ) : null}
        </div>

        {/* Footer: activity + open CTA */}
        <div className="flex items-center justify-between border-t border-gray-100 pt-2.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
            {relativeTime(row.last_activity_at ?? row.created_at)} ago
            {row.assigned_tech_id ? ` · ${getStaffName(row.assigned_tech_id)}` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              onOpenWorkspace();
              onDismiss();
            }}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Open →
          </button>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
