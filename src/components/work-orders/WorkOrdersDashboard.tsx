'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { getDaysLateNullable, getDaysLateTone } from '@/utils/date';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { dataValue } from '@/design-system/tokens/typography/presets';
import { framerTransition, framerPresence } from '@/design-system/foundations/motion-framer';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { useTodayStaffAvailability } from '@/hooks/useTodayStaffAvailability';
import { ShippedDetailsPanel } from '@/components/shipped/ShippedDetailsPanel';
import { WorkOrderDetailsPanel } from '@/components/shipped/details-panel/WorkOrderDetailsPanel';
import { WorkOrderInfoChips } from './WorkOrderInfoStrip';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { getStaffTextColor } from '@/design-system/components/StaffBadge';
import { saveWorkOrder } from '@/lib/work-orders/saveWorkOrder';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from './WorkOrderAssignmentCard';
import { SkuStockAssignPanel } from './SkuStockAssignPanel';
import { LocalPickupTable } from './LocalPickupTable';
import {
  ASSIGN_SESSION_FEEDBACK_EVENT,
  OPEN_ASSIGN_SESSION_EVENT,
  type AssignSessionFeedbackDetail,
} from './assign-session-events';
import {
  type WorkOrderRow,
  type QueueCounts,
  EMPTY_COUNTS,
  normalizeQueue,
} from './types';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
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

  const queryClient = useQueryClient();
  const { data: workOrdersData, isLoading: loading } = useQuery<{ rows: WorkOrderRow[]; counts: QueueCounts }>({
    queryKey: ['work-orders', queue, query],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/work-orders?queue=${queue}&q=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  // Local state for optimistic updates — synced from query data
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  useEffect(() => {
    if (workOrdersData) {
      setRows(Array.isArray(workOrdersData.rows) ? workOrdersData.rows : []);
      setCounts({ ...EMPTY_COUNTS, ...(workOrdersData.counts || {}) });
    }
  }, [workOrdersData]);

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
    .filter((m) => m.role === 'technician')
    .map((m) => ({ id: Number(m.id), name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const packerOptions = packersOn
    .filter((m) => m.role === 'packer')
    .map((m) => ({ id: Number(m.id), name: m.name }));
  const onTechIds = new Set(technicianOptions.map((m) => m.id));
  const onPackerIds = new Set(packerOptions.map((m) => m.id));
  const staffContext = {
    techniciansOn: technicianOptions,
    techniciansOff: techniciansOff
      .filter((m) => m.role === 'technician')
      .map((m) => ({ id: Number(m.id), name: m.name }))
      .filter((m) => !onTechIds.has(m.id)),
    techniciansInactive: techniciansInactive
      .filter((m) => m.role === 'technician')
      .map((m) => ({ id: Number(m.id), name: m.name })),
    packersOn: packerOptions,
    packersOff: packersOff
      .map((m) => ({ id: Number(m.id), name: m.name }))
      .filter((m) => !onPackerIds.has(m.id)),
    packersInactive: packersInactive
      .map((m) => ({ id: Number(m.id), name: m.name })),
  };

  const refreshRows = useCallback(async (opts?: { pendingOrderId?: number }) => {
    await queryClient.invalidateQueries({ queryKey: ['work-orders', queue, query] });
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    const pid = opts?.pendingOrderId;
    if (pid != null && Number.isFinite(pid) && pid > 0) {
      dispatchPendingOrderRowRefetch(pid);
    } else {
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    }
  }, [queryClient, queue, query]);

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
      await saveWorkOrder({
        entityType: row.entityType,
        entityId: row.entityId,
        assignedTechId: newTechId,
        assignedPackerId: newPackerId,
        status: newStatus,
        priority: row.priority,
        deadlineAt: row.deadlineAt,
        notes: row.notes,
      });
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
      await saveWorkOrder({
        entityType: row.entityType,
        entityId: row.entityId,
        assignedTechId: newTechId,
        assignedPackerId: newPackerId !== null ? newPackerId : undefined,
        status: newStatus,
        priority: row.priority,
        deadlineAt: deadline,
        notes: row.notes,
      });
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
        window.dispatchEvent(new CustomEvent<AssignSessionFeedbackDetail>(
          ASSIGN_SESSION_FEEDBACK_EVENT,
          { detail: { message: 'Assign Session is available for active work queues only.' } }
        ));
        return;
      }
      if (!rowsNeedingAssignment.length) {
        window.dispatchEvent(new CustomEvent<AssignSessionFeedbackDetail>(
          ASSIGN_SESSION_FEEDBACK_EVENT,
          { detail: { message: 'Nothing needs assignment in the current view.' } }
        ));
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
    window.addEventListener(OPEN_ASSIGN_SESSION_EVENT as any, handleOpenAssignSession as any);
    return () => {
      window.removeEventListener(OPEN_ASSIGN_SESSION_EVENT as any, handleOpenAssignSession as any);
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
          selectedRow.entityType === 'ORDER' ? (
            <ShippedDetailsPanel
              shipped={buildWorkOrderDashboardRecord(selectedRow)}
              context="queue"
              onClose={handleClosePanel}
              onUpdate={handleSaved}
            />
          ) : (
            <WorkOrderDetailsPanel
              row={selectedRow}
              onClose={handleClosePanel}
              onSaved={handleSaved}
              queue={queue}
              query={query}
              disableMoveUp={selectedIndex <= 0}
              disableMoveDown={selectedIndex < 0 || selectedIndex >= rows.length - 1}
            />
          )
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

function buildWorkOrderDashboardRecord(row: WorkOrderRow): ShippedOrder & { out_of_stock: string | null } {
  return {
    id: row.entityId,
    deadline_at: row.deadlineAt,
    ship_by_date: row.deadlineAt,
    order_id: row.orderId || row.recordLabel,
    product_title: row.title,
    quantity: row.quantity || null,
    item_number: row.itemNumber || null,
    condition: row.condition || 'USED',
    shipment_id: row.shipmentId ?? null,
    shipping_tracking_number: row.trackingNumber || null,
    tracking_numbers: Array.isArray((row as any).trackingNumbers)
      ? (row as any).trackingNumbers
      : (row.trackingNumber ? [row.trackingNumber] : []),
    tracking_number_rows: Array.isArray(row.trackingNumberRows)
      ? row.trackingNumberRows.map((trackingRow) => ({
          shipment_id: trackingRow.shipment_id,
          tracking: trackingRow.tracking_number_raw,
          is_primary: trackingRow.is_primary,
        }))
      : [],
    serial_number: '',
    sku: row.sku || '',
    tester_id: row.techId ?? null,
    tested_by: row.techId ?? null,
    test_date_time: null,
    packer_id: row.packerId ?? null,
    packed_by: row.packerId ?? null,
    packed_at: null,
    packer_photos_url: [],
    tracking_type: null,
    account_source: row.accountSource || null,
    notes: row.notes || '',
    status_history: [],
    created_at: row.createdAt || null,
    tester_name: row.techName || null,
    packed_by_name: row.packerName || null,
    tested_by_name: row.techName || null,
    is_shipped: false,
    out_of_stock: row.outOfStock || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — matches PendingOrdersTable (OrdersQueueTableRow) layout
// ─────────────────────────────────────────────────────────────────────────────



interface WorkOrderTableRowProps {
  row: WorkOrderRow;
  isSelected: boolean;
  isSaving: boolean;
  getStaffName: (id: number | null | undefined) => string;
  onClick: (row: WorkOrderRow) => void;
  useAlternateStripe: boolean;
}

function WorkOrderTableRow({
  row,
  isSelected,
  isSaving,
  getStaffName,
  onClick,
  useAlternateStripe,
}: WorkOrderTableRowProps) {
  const techName = row.techName || (row.techId ? getStaffName(row.techId) : null);
  const packerName = row.packerName || (row.packerId ? getStaffName(row.packerId) : null);
  const techDisplay = techName || '---';
  const packerDisplay = row.entityType === 'SKU_STOCK' ? null : (packerName || '---');

  const daysLate = getDaysLateNullable(row.deadlineAt);
  const outOfStockValue = String(row.outOfStock || '').trim();
  const hasOutOfStock = outOfStockValue !== '';

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
            <span className={techName ? getStaffTextColor(row.techId) : undefined}>{techDisplay}</span>
            {packerDisplay !== null && (
              <>{' \u2022 '}<span className={packerName ? getStaffTextColor(row.packerId) : undefined}>{packerDisplay}</span></>
            )}
            {daysLate !== null && (
              <>{' \u2022 '}<span className={getDaysLateTone(daysLate)}>{daysLate}</span></>
            )}
            {hasOutOfStock && (
              <>{' \u2022 '}<span className="text-red-600">{outOfStockValue}</span></>
            )}
            {row.priority < 100 && (
              <>{' \u2022 '}<span className="text-rose-600">P{row.priority}</span></>
            )}
          </div>
        </div>
      </div>

      {/* Right: copy chips */}
      <div className="flex items-center shrink-0 gap-1.5">
        <WorkOrderInfoChips row={row} />
      </div>
    </motion.div>
  );
}
