'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { dataValue } from '@/design-system/tokens/typography/presets';
import { framerTransition, framerPresence } from '@/design-system/foundations/motion-framer';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { useTodayStaffAvailability } from '@/hooks/useTodayStaffAvailability';
import { WorkOrderDetailsPanel } from '@/components/shipped/details-panel/WorkOrderDetailsPanel';
import { WorkOrderInfoChips } from './WorkOrderInfoStrip';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { TECH_IDS } from '@/utils/staff';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from './WorkOrderAssignmentCard';
import { SkuStockAssignPanel } from './SkuStockAssignPanel';
import { LocalPickupTable } from './LocalPickupTable';
import {
  type WorkOrderRow,
  type QueueCounts,
  EMPTY_COUNTS,
  normalizeQueue,
} from './types';
import { dispatchPendingOrderRowRefetch } from '@/utils/events';

export type { WorkOrderRow };

interface AssigningState {
  rows: WorkOrderRow[];
  startIndex: number;
  mode: 'single' | 'session';
  storageKey?: string;
}

function buildWorkOrdersHref(params: URLSearchParams, basePath = '/work-orders') {
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function WorkOrdersDashboard({ basePath = '/work-orders' }: { basePath?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const query = searchParams.get('q') || '';
  const entityTypeParam = searchParams.get('entityType');
  const entityIdParam = Number(searchParams.get('entityId'));

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [assigningState, setAssigningState] = useState<AssigningState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getStaffName } = useStaffNameMap();
  const {
    all: staff,
    techniciansOn,
    packersOn,
    techniciansOff,
    packersOff,
    techniciansInactive,
    packersInactive,
  } = useTodayStaffAvailability();

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;
    setLoading(true);
    fetch(`/api/work-orders?queue=${queue}&q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to fetch'))))
      .then((json) => {
        if (!isCurrent) return;
        setRows(Array.isArray(json?.rows) ? json.rows : []);
        setCounts({ ...EMPTY_COUNTS, ...(json?.counts || {}) });
      })
      .catch((err) => {
        if (!isCurrent) return;
        if (err.name !== 'AbortError') {
          setRows([]);
          setCounts(EMPTY_COUNTS);
        }
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });
    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [queue, query]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    const focused =
      entityTypeParam && Number.isFinite(entityIdParam)
        ? rows.find((r) => r.entityType === entityTypeParam && r.entityId === entityIdParam)
        : null;
    if (focused) { setSelectedId(focused.id); return; }
    if (!selectedId || !rows.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  );
  const selectedIndex = useMemo(
    () => rows.findIndex((r) => r.id === selectedId),
    [rows, selectedId]
  );

  useEffect(() => {
    if (isPanelOpen && !selectedRow) setIsPanelOpen(false);
  }, [isPanelOpen, selectedRow]);

  useEffect(() => {
    const handleNavigateDetails = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (!isPanelOpen || rows.length === 0 || !selectedId) return;
      const currentIndex = rows.findIndex((record) => record.id === selectedId);
      if (currentIndex < 0) return;
      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRow = rows[currentIndex + step];
      if (!nextRow) return;
      setSelectedId(nextRow.id);
      setIsPanelOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.set('entityType', nextRow.entityType);
      params.set('entityId', String(nextRow.entityId));
      router.replace(buildWorkOrdersHref(params, basePath));
    };
    window.addEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    };
  }, [isPanelOpen, rows, selectedId, searchParams, router, basePath]);

  const technicianOptions = techniciansOn
    .filter((m) => m.role === 'technician' && TECH_IDS.includes(Number(m.id)))
    .map((m) => ({ id: Number(m.id), name: m.name }))
    .sort((a, b) => TECH_IDS.indexOf(a.id) - TECH_IDS.indexOf(b.id));
  const packerOptions = packersOn
    .filter((m) => m.role === 'packer')
    .map((m) => ({ id: Number(m.id), name: m.name }));
  const onTechIds = new Set(technicianOptions.map((m) => m.id));
  const onPackerIds = new Set(packerOptions.map((m) => m.id));
  const staffContext = {
    techniciansOn: technicianOptions,
    techniciansOff: techniciansOff
      .filter((m) => TECH_IDS.includes(Number(m.id)))
      .map((m) => ({ id: Number(m.id), name: m.name }))
      .filter((m) => !onTechIds.has(m.id)),
    techniciansInactive: techniciansInactive
      .filter((m) => TECH_IDS.includes(Number(m.id)))
      .map((m) => ({ id: Number(m.id), name: m.name })),
    packersOn: packerOptions,
    packersOff: packersOff
      .map((m) => ({ id: Number(m.id), name: m.name }))
      .filter((m) => !onPackerIds.has(m.id)),
    packersInactive: packersInactive
      .map((m) => ({ id: Number(m.id), name: m.name })),
  };

  const refreshRows = useCallback(async (opts?: { pendingOrderId?: number }) => {
    const res = await fetch(
      `/api/work-orders?queue=${queue}&q=${encodeURIComponent(query)}`,
    );
    const json = await res.json();
    setRows(Array.isArray(json?.rows) ? json.rows : []);
    setCounts({ ...EMPTY_COUNTS, ...(json?.counts || {}) });
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    const pid = opts?.pendingOrderId;
    if (pid != null && Number.isFinite(pid) && pid > 0) {
      dispatchPendingOrderRowRefetch(pid);
    } else {
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    }
  }, [queue, query]);

  const clearEntitySelectionParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('entityType');
    params.delete('entityId');
    router.replace(buildWorkOrdersHref(params, basePath));
  }, [searchParams, router, basePath]);

  const handleRowClick = useCallback((row: WorkOrderRow) => {
    if (selectedId === row.id && isPanelOpen) {
      setIsPanelOpen(false);
      setSelectedId(null);
      clearEntitySelectionParams();
      return;
    }
    setSelectedId(row.id);
    setIsPanelOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set('entityType', row.entityType);
    params.set('entityId', String(row.entityId));
    router.replace(buildWorkOrdersHref(params, basePath));
  }, [selectedId, isPanelOpen, searchParams, router, clearEntitySelectionParams, basePath]);

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
    setSelectedId(null);
    clearEntitySelectionParams();
  }, [clearEntitySelectionParams]);

  const handleSaved = useCallback(() => { void refreshRows(); }, [refreshRows]);

  const handleInlineAssign = async (
    row: WorkOrderRow,
    type: 'tech' | 'packer',
    staffId: number
  ) => {
    if (savingRowId) return;
    setSavingRowId(row.id);
    const newTechId = type === 'tech' ? staffId : row.techId;
    const newPackerId = type === 'packer' ? staffId : row.packerId;
    const newStatus =
      newTechId && newPackerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status;
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? { ...r, techId: newTechId, packerId: newPackerId, status: newStatus }
          : r
      )
    );
    try {
      const res = await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: row.entityType,
          entityId: row.entityId,
          assignedTechId: newTechId,
          assignedPackerId: newPackerId,
          status: newStatus,
          priority: row.priority,
          deadlineAt: row.deadlineAt,
          notes: row.notes,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to assign');
      }
      await refreshRows(
        row.entityType === 'ORDER' ? { pendingOrderId: row.entityId } : undefined
      );
    } catch (err: any) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      window.alert(err?.message || 'Failed to assign staff');
    } finally {
      setSavingRowId(null);
    }
  };

  const handleAssignConfirm = useCallback(async (
    row: WorkOrderRow,
    { techId: newTechId, packerId: newPackerId, deadline, status: statusOverride }: AssignmentConfirmPayload
  ) => {
    const newStatus =
      statusOverride ??
      (newTechId && newPackerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);
    const newTechName = newTechId
      ? (staff.find((s) => Number(s.id) === newTechId)?.name ?? null)
      : null;
    const newPackerName = newPackerId
      ? (staff.find((s) => Number(s.id) === newPackerId)?.name ?? null)
      : null;
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              techId: newTechId,
              techName: newTechId ? (newTechName ?? r.techName) : null,
              packerId: newPackerId,
              packerName: newPackerId ? (newPackerName ?? r.packerName) : null,
              deadlineAt: deadline,
              status: newStatus,
            }
          : r
      )
    );
    try {
      const patchBody: Record<string, unknown> = {
        entityType: row.entityType,
        entityId: row.entityId,
        assignedTechId: newTechId,
        status: newStatus,
        priority: row.priority,
        deadlineAt: deadline,
        notes: row.notes,
      };
      if (newPackerId !== null) patchBody.assignedPackerId = newPackerId;
      const res = await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || 'Failed to assign');
      }
      void refreshRows(
        row.entityType === 'ORDER' ? { pendingOrderId: row.entityId } : undefined
      );
    } catch (err: any) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      window.alert(err?.message || 'Failed to assign staff');
    }
  }, [refreshRows, staff]);

  // Refresh when external events change order state (tech scan, OOS update, etc.)
  useEffect(() => {
    const handleExternalRefresh = () => { void refreshRows(); };
    window.addEventListener('usav-refresh-data', handleExternalRefresh);
    window.addEventListener('dashboard-refresh', handleExternalRefresh);
    return () => {
      window.removeEventListener('usav-refresh-data', handleExternalRefresh);
      window.removeEventListener('dashboard-refresh', handleExternalRefresh);
    };
  }, [refreshRows]);

  const unassignedRows = rows.filter((r) => !r.techId && !r.packerId);
  const assignedRows = rows.filter((r) => r.techId != null || r.packerId != null);
  const rowsNeedingAssignment = useMemo(
    () => rows.filter((r) => (
      r.entityType === 'SKU_STOCK'
        ? r.techId == null
        : r.techId == null || r.packerId == null
    )),
    [rows]
  );

  useEffect(() => {
    const handleOpenAssignSession = () => {
      if (queue === 'local_pickups' || queue === 'stock_replenish') {
        window.alert('Assign session is not available for this queue.');
        return;
      }
      if (!rowsNeedingAssignment.length) {
        window.alert('No assignable work orders in this view.');
        return;
      }
      const keyQueue = queue || 'all';
      const keyQuery = query.trim().toLowerCase() || '__all__';
      const storageKey = `work-orders:assign-session:${keyQueue}:${keyQuery}`;
      setAssigningState({
        rows: rowsNeedingAssignment,
        startIndex: 0,
        mode: 'session',
        storageKey,
      });
    };
    window.addEventListener('work-orders-open-assign-session' as any, handleOpenAssignSession as any);
    return () => {
      window.removeEventListener('work-orders-open-assign-session' as any, handleOpenAssignSession as any);
    };
  }, [queue, query, rowsNeedingAssignment]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-white">
      {/* Header */}
      <div className={mainStickyHeaderClass}>
        <div className={mainStickyHeaderRowClass}>
          <div className="flex min-w-0 items-center gap-3">
            <h1 className={`${dataValue} uppercase tracking-tight`}>
              {queue === 'stock_replenish' ? 'Stock Replenish' : 'Work Queue'}
            </h1>
            {queue !== 'stock_replenish' && (
              <span className="text-[11px] font-bold tabular-nums text-slate-400">
                {counts[queue] ?? rows.length}
                {query ? ` \u00B7 "${query}"` : ''}
              </span>
            )}
          </div>
          {queue !== 'stock_replenish' && queue !== 'local_pickups' && unassignedRows.length > 0 && (
            <span className="text-[10px] font-black uppercase tracking-widest text-orange-500">
              {unassignedRows.length} unassigned
            </span>
          )}
        </div>
      </div>

      {/* Stock / Local Pickup — dedicated panels */}
      {queue === 'stock_replenish' ? (
        <SkuStockAssignPanel technicianOptions={technicianOptions} packerOptions={packerOptions} />
      ) : queue === 'local_pickups' ? (
        <LocalPickupTable />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                No work orders in queue
              </p>
            </div>
          ) : (
            <div className="flex w-full flex-col">
              {rows.map((row, i) => (
                <WorkOrderTableRow
                  key={row.id}
                  row={row}
                  isSelected={selectedId === row.id}
                  isSaving={savingRowId === row.id}
                  getStaffName={getStaffName}
                  onClick={handleRowClick}
                  onOpenAssign={() => setAssigningState({ rows: [row], startIndex: 0, mode: 'single' })}
                  useAlternateStripe={i % 2 === 0}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Details panel */}
      <AnimatePresence>
        {isPanelOpen && selectedRow && (
          <WorkOrderDetailsPanel
            row={selectedRow}
            onClose={handleClosePanel}
            onSaved={handleSaved}
            queue={queue}
            query={query}
            disableMoveUp={selectedIndex <= 0}
            disableMoveDown={selectedIndex < 0 || selectedIndex >= rows.length - 1}
          />
        )}
      </AnimatePresence>

      {/* Assignment card */}
      <AnimatePresence>
        {assigningState && (
          <WorkOrderAssignmentCard
            key={assigningState.mode === 'session' ? (assigningState.storageKey || 'assignment-session') : 'assignment-card'}
            rows={assigningState.rows}
            startIndex={assigningState.startIndex}
            technicianOptions={technicianOptions}
            packerOptions={packerOptions}
            onConfirm={handleAssignConfirm}
            storageKey={assigningState.mode === 'session' ? assigningState.storageKey : undefined}
            allowEditConfirmed={assigningState.mode === 'session'}
            closeWhenCompleted={assigningState.mode !== 'session'}
            staffContext={staffContext}
            onClose={() => setAssigningState(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — matches PendingOrdersTable (OrdersQueueTableRow) layout
// ─────────────────────────────────────────────────────────────────────────────

function getDaysLate(deadlineAt: string | null): number | null {
  if (!deadlineAt) return null;
  const deadline = new Date(deadlineAt);
  if (isNaN(deadline.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - deadline.getTime();
  return diffMs > 0 ? Math.floor(diffMs / 86400000) : 0;
}

function getDaysLateTone(days: number | null) {
  if (days === null) return 'text-gray-500';
  if (days > 1) return 'text-red-600';
  if (days === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

interface WorkOrderTableRowProps {
  row: WorkOrderRow;
  isSelected: boolean;
  isSaving: boolean;
  getStaffName: (id: number | null | undefined) => string;
  onClick: (row: WorkOrderRow) => void;
  onOpenAssign: () => void;
  useAlternateStripe: boolean;
}

function WorkOrderTableRow({
  row,
  isSelected,
  isSaving,
  getStaffName,
  onClick,
  onOpenAssign,
  useAlternateStripe,
}: WorkOrderTableRowProps) {
  const isUnassigned =
    row.entityType === 'SKU_STOCK' ? !row.techId : !row.techId || !row.packerId;

  const techName = row.techName || (row.techId ? getStaffName(row.techId) : null);
  const packerName = row.packerName || (row.packerId ? getStaffName(row.packerId) : null);
  const techDisplay = techName || '---';
  const packerDisplay = row.entityType === 'SKU_STOCK' ? null : (packerName || '---');

  const daysLate = getDaysLate(row.deadlineAt);
  const hasOutOfStock = Boolean(row.outOfStock);

  // Dot color matches PendingOrdersTable: green = tested, red = out of stock, yellow = pending
  const dotColor = row.hasTechScan
    ? 'bg-emerald-500'
    : hasOutOfStock
      ? 'bg-red-500'
      : 'bg-yellow-400';
  const dotTitle = row.hasTechScan
    ? 'Scanned by tech'
    : hasOutOfStock
      ? 'Out of stock'
      : 'Pending order';

  return (
    <motion.div
      {...framerPresence.tableRow}
      transition={framerTransition.tableRowMount}
      data-work-order-row-id={row.id}
      role="button"
      tabIndex={0}
      onClick={() => onClick(row)}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(row); }
      }}
      aria-pressed={isSelected}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-all border-b border-gray-300 cursor-pointer hover:bg-blue-50/50 ${
        isSelected ? 'bg-blue-50/80' : useAlternateStripe ? 'bg-white' : 'bg-gray-50/10'
      } ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {/* Left: title + detail row */}
      <div className="flex flex-col min-w-0">
        {/* Row 1: dot + title */}
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full ${dotColor} shrink-0`} title={dotTitle} />
          <span className="text-[12px] font-bold text-gray-900 truncate">
            {row.title || 'Unknown'}
          </span>
        </div>

        {/* Row 2: qty • condition • tech • packer • days late • priority • deadline */}
        <div className="mt-0.5 flex items-center gap-2">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate min-w-0 flex-1">
            {row.quantity && <><span className={parseInt(String(row.quantity), 10) > 1 ? 'text-yellow-600' : 'text-gray-500'}>{row.quantity}</span>{' \u2022 '}</>}
            {row.condition && <><span className={row.condition.toLowerCase() === 'new' ? 'text-yellow-600' : undefined}>{row.condition}</span>{' \u2022 '}</>}
            <span className={techName ? stationThemeColors[getStaffThemeById(row.techId)].text : undefined}>{techDisplay}</span>
            {packerDisplay !== null && (
              <>{' \u2022 '}<span className={packerName ? stationThemeColors[getStaffThemeById(row.packerId)].text : undefined}>{packerDisplay}</span></>
            )}
            {daysLate !== null && (
              <>{' \u2022 '}<span className={getDaysLateTone(daysLate)}>{daysLate}</span></>
            )}
            {row.priority < 100 && (
              <>{' \u2022 '}<span className="text-rose-600">P{row.priority}</span></>
            )}
          </div>
        </div>
      </div>

      {/* Right: chips + assign button */}
      <div className="flex items-center shrink-0 gap-1.5">
        <WorkOrderInfoChips row={row} />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenAssign(); }}
          className={`h-6 px-2.5 rounded text-[8px] font-black uppercase tracking-wider border transition-all active:scale-95 ${
            isUnassigned
              ? 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100'
              : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
          }`}
        >
          {isUnassigned ? 'Assign' : 'Edit'}
        </button>
      </div>
    </motion.div>
  );
}
