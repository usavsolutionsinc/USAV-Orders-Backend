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

export interface ApiResponse {
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

export interface RecentActivityRailBaseProps {
  /** Currently selected line id — gets a highlight ring so the rail mirrors the workspace. */
  selectedLineId: number | null;
  /**
   * Full selected row, when available. Used as a fallback so the active line
   * is *always* present in the rail.
   */
  selectedRow?: ReceivingLineRow | null;
  /** Cap on rendered rows. */
  limit?: number;

  // --- Shell customizations ---
  /** React-query key. */
  queryKey: ReadonlyArray<unknown>;
  /** Fetcher — allows different API routes or params per shell. */
  fetchFn: () => Promise<ApiResponse>;
  /** Custom event to listen for optimistic line updates. */
  updateEvent: string;
  /** Custom events that should trigger a full query invalidation. */
  refreshEvents: string[];

  /** Top eyebrow label (e.g. "Recent"). */
  eyebrowTitle: string;
  /** Secondary label on the right (e.g. "Same as History"). */
  eyebrowSuffix?: string;

  /** Color logic for the left status dot. */
  getStatusDot: (row: ReceivingLineRow) => string;
  /** Label/value display for the line (e.g. "1/1" or "Tested"). */
  renderQuantity: (row: ReceivingLineRow) => React.ReactNode;

  /** Label for the progress bar in the popover (e.g. "Received" or "Tested"). */
  previewQtyLabel: string;
  /** Values for the progress bar and fractional display in the popover. */
  getPreviewQty: (row: ReceivingLineRow) => { current: number; total: number | null };
}

/**
 * Base sidebar rail component. Parameterized via props to support both
 * Receiving and Testing specific live feeds while sharing the same
 * layout, grouping logic, and hover-preview popover.
 */
export function RecentActivityRailBase({
  selectedLineId,
  selectedRow = null,
  limit = 25,
  queryKey,
  fetchFn,
  updateEvent,
  refreshEvents,
  eyebrowTitle,
  eyebrowSuffix,
  getStatusDot,
  renderQuantity,
  previewQtyLabel,
  getPreviewQty,
}: RecentActivityRailBaseProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ApiResponse>({
    queryKey,
    queryFn: fetchFn,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

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
    window.addEventListener(updateEvent, handlePatch);
    return () => window.removeEventListener(updateEvent, handlePatch);
  }, [updateEvent]);

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey });
    };
    refreshEvents.forEach((ev) => window.addEventListener(ev, handler));
    return () => {
      refreshEvents.forEach((ev) => window.removeEventListener(ev, handler));
    };
  }, [queryClient, queryKey, refreshEvents]);

  const allRows = localRows ?? [];
  const rows = useMemo(() => {
    const top = allRows.slice(0, limit);
    if (selectedLineId == null) return top;
    if (top.some((r) => r.id === selectedLineId)) return top;
    const fromDataset = allRows.find((r) => r.id === selectedLineId);
    const pin = fromDataset ?? selectedRow;
    if (!pin || pin.id !== selectedLineId) return top;
    return [pin, ...top];
  }, [allRows, limit, selectedLineId, selectedRow]);

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

  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const toggleGroup = useCallback((groupId: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

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
      if (focusIndex >= 0 && focusIndex < rows.length) {
        e.preventDefault();
        dispatchSelectLine(rows[focusIndex]);
      }
    }
  }, [rows, focusIndex, focusRow]);

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
          <p className="text-[8.5px] font-bold uppercase tracking-widest text-gray-300">
            {eyebrowSuffix}
          </p>
        )}
      </div>
      {isLoading && rows.length === 0 ? (
        <div className="space-y-1 px-3 py-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-full animate-pulse rounded-md bg-gray-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-micro font-semibold text-gray-400">
          No recent activity yet.
        </p>
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
              const isCollapsed =
                g.groupId != null && collapsedGroups.has(g.groupId);
              if (isCollapsed && g.groupIndex > 0) return [];

              const isLeaderOfMulti =
                g.groupSize > 1 && g.groupIndex === 0 && g.groupId != null;
              const showExpandedHeader = isLeaderOfMulti && !isCollapsed;

              const nodes: React.ReactElement[] = [];

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
                  showInlinePkgChip={isLeaderOfMulti && isCollapsed}
                  onToggleGroup={
                    isLeaderOfMulti
                      ? () => toggleGroup(g.groupId as number)
                      : undefined
                  }
                  getStatusDot={getStatusDot}
                  renderQuantity={renderQuantity}
                  previewQtyLabel={previewQtyLabel}
                  getPreviewQty={getPreviewQty}
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
  getStatusDot,
  renderQuantity,
  previewQtyLabel,
  getPreviewQty,
  onClick,
}: {
  row: ReceivingLineRow;
  isSelected: boolean;
  isFocused: boolean;
  groupSize: number;
  groupIndex: number;
  groupId: number | null;
  isCollapsed: boolean;
  showInlinePkgChip: boolean;
  onToggleGroup?: () => void;
  getStatusDot: (row: ReceivingLineRow) => string;
  renderQuantity: (row: ReceivingLineRow) => React.ReactNode;
  previewQtyLabel: string;
  getPreviewQty: (row: ReceivingLineRow) => { current: number; total: number | null };
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
  const techId = row.assigned_tech_id ?? null;
  const techColor = techId
    ? stationThemeColors[getStaffThemeById(techId)].text
    : 'text-gray-400';
  const activityAt = row.last_activity_at ?? row.created_at;

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
            ? 'bg-blue-100/80 ring-2 ring-inset ring-blue-500/60 shadow-sm'
            : isFocused
              ? 'bg-gray-50 ring-1 ring-inset ring-gray-200'
              : 'hover:bg-gray-50'
        }`}
      >
        {isSelected ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1 left-0 z-20 w-[3px] rounded-full bg-blue-600"
          />
        ) : null}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${getStatusDot(row)}`}
          aria-hidden
          title={row.workflow_status || undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p
              className={`truncate text-caption font-bold ${
                isSelected ? 'text-blue-900' : 'text-gray-900'
              }`}
              title={title}
            >
              {title}
            </p>
            {showInlinePkgChip ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleGroup?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleGroup?.();
                  }
                }}
                title={`Expand — show ${groupSize - 1} more in this package`}
                aria-expanded={false}
                aria-label="Expand package"
                className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-indigo-100 px-1 py-px text-[8.5px] font-black uppercase tracking-widest text-indigo-700 transition-colors hover:bg-indigo-200"
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
              </span>
            ) : null}
          </div>
          <p className="truncate text-eyebrow font-semibold uppercase tracking-widest text-gray-500">
            {renderQuantity(row)}
            {techId ? (
              <span className={`ml-1 ${techColor}`}>
                · {getStaffName(techId)}
              </span>
            ) : null}
          </p>
        </div>
        <span className="shrink-0 tabular-nums text-eyebrow font-bold text-gray-400">
          {relativeTime(activityAt)}
        </span>
      </button>
      <AnimatePresence>
        {previewOpen ? (
          <RowPreviewPopover
            row={row}
            anchorEl={rowRef.current}
            groupSize={groupSize}
            qtyLabel={previewQtyLabel}
            getQty={getPreviewQty}
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
  qtyLabel: string;
  getQty: (row: ReceivingLineRow) => { current: number; total: number | null };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenWorkspace: () => void;
  onDismiss: () => void;
}

function RowPreviewPopover({
  row,
  anchorEl,
  groupSize,
  qtyLabel,
  getQty,
  onMouseEnter,
  onMouseLeave,
  onOpenWorkspace,
  onDismiss,
}: RowPreviewPopoverProps) {
  const title = row.item_name || row.sku || row.zoho_item_id || `Line #${row.id}`;
  const { current: qtyCurrent, total: qtyTotal } = getQty(row);
  const isComplete = qtyTotal != null && qtyTotal > 0 && qtyCurrent >= qtyTotal;
  const progressPct =
    qtyTotal != null && qtyTotal > 0
      ? Math.min(100, Math.round((qtyCurrent / qtyTotal) * 100))
      : qtyCurrent > 0
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

  const POPOVER_WIDTH = 320;
  const POPOVER_FALLBACK_HEIGHT = 440;
  const VIEWPORT_PADDING = 8;
  const GAP = 10;
  const [coords, setCoords] = useState<{ left: number; top: number; flipped: boolean } | null>(
    null,
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const measurePosition = useCallback(() => {
    if (!anchorEl) return null;
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rightSpace = vw - rect.right;
    const flipped = rightSpace < POPOVER_WIDTH + GAP + 12;
    const left = flipped
      ? Math.max(VIEWPORT_PADDING, rect.left - POPOVER_WIDTH - GAP)
      : Math.min(vw - POPOVER_WIDTH - VIEWPORT_PADDING, rect.right + GAP);

    const popH =
      popoverRef.current?.getBoundingClientRect().height ?? POPOVER_FALLBACK_HEIGHT;
    const desiredTop = rect.top;
    const maxTop = Math.max(VIEWPORT_PADDING, vh - popH - VIEWPORT_PADDING);
    const top = Math.max(VIEWPORT_PADDING, Math.min(desiredTop, maxTop));

    return { left, top, flipped };
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const apply = () => {
      const next = measurePosition();
      if (!next) return;
      setCoords(next);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('scroll', apply, true);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('scroll', apply, true);
    };
  }, [anchorEl, measurePosition]);

  const previewVisible = coords !== null;
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!anchorEl || !previewVisible || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const next = measurePosition();
      if (next) setCoords(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchorEl, previewVisible, measurePosition]);

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
      ref={popoverRef}
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
        zIndex: 9999,
      }}
      className="rounded-xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5"
    >
      <div className="space-y-3 p-3.5">
        <div>
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm font-black leading-snug text-gray-900">
              {title}
            </p>
            {groupSize > 1 ? (
              <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest text-indigo-700">
                PKG · {groupSize}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${conditionTone}`}>
              {conditionLabel}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ${workflowTone}`}>
              {workflowLabel}
            </span>
            {row.needs_test ? (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-orange-700">
                Test
              </span>
            ) : null}
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ${
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

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
              {qtyLabel}
            </span>
            <span className={`text-caption font-black tabular-nums ${isComplete ? 'text-emerald-600' : 'text-gray-700'}`}>
              {qtyCurrent}
              <span className="text-gray-300 mx-0.5">/</span>
              <span className="text-gray-400">{qtyTotal ?? '?'}</span>
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

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3">
          <OrderIdChip value={poValue} display={getLast4(poValue)} />
          <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
          <TrackingChip value={trackingValue} display={getLast4(trackingValue)} />
          {serialsCsv ? (
            <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 pt-2.5">
          <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">
            {relativeTime(row.last_activity_at ?? row.created_at)} ago
            {row.assigned_tech_id ? ` · ${getStaffName(row.assigned_tech_id)}` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              onOpenWorkspace();
              onDismiss();
            }}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-micro font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            Open →
          </button>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
