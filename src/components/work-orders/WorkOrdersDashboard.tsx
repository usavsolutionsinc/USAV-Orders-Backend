'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { WorkOrderDetailsPanel } from '@/components/shipped/details-panel/WorkOrderDetailsPanel';
import { OrderStaffAssignmentButtons } from '@/components/ui/OrderStaffAssignmentButtons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { WorkOrderAssignmentCard } from './WorkOrderAssignmentCard';
import { SkuStockAssignPanel } from './SkuStockAssignPanel';
import {
  type WorkOrderRow,
  type QueueCounts,
  EMPTY_COUNTS,
  STATUS_COLOR,
  normalizeQueue,
  formatDate,
} from './types';

export type { WorkOrderRow };

export function WorkOrdersDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = normalizeQueue(searchParams.get('queue'));
  const query = searchParams.get('q') || '';
  const entityTypeParam = searchParams.get('entityType');
  const entityIdParam = Number(searchParams.get('entityId'));

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [assigningState, setAssigningState] = useState<{ rows: WorkOrderRow[]; startIndex: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { getStaffName } = useStaffNameMap();

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((members) => { if (active) setStaff(members); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/work-orders?queue=${queue}&q=${encodeURIComponent(query)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to fetch'))))
      .then((json) => {
        setRows(Array.isArray(json?.rows) ? json.rows : []);
        setCounts({ ...EMPTY_COUNTS, ...(json?.counts || {}) });
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setRows([]);
          setCounts(EMPTY_COUNTS);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
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

  // Keep selectedRow in sync when rows refresh
  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId]
  );
  const selectedIndex = useMemo(
    () => rows.findIndex((r) => r.id === selectedId),
    [rows, selectedId]
  );

  // Close panel when selected row disappears from results
  useEffect(() => {
    if (isPanelOpen && !selectedRow) {
      setIsPanelOpen(false);
    }
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
      router.replace(`/work-orders?${params.toString()}`);
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    };
  }, [isPanelOpen, rows, selectedId, searchParams, router]);

  const TECH_IDS = [1, 2, 3, 6];
  const technicianOptions = staff
    .filter((m) => m.role === 'technician' && TECH_IDS.includes(Number(m.id)))
    .map((m) => ({ id: Number(m.id), name: m.name }))
    .sort((a, b) => TECH_IDS.indexOf(a.id) - TECH_IDS.indexOf(b.id));
  const packerOptions = staff
    .filter((m) => m.role === 'packer')
    .map((m) => ({ id: Number(m.id), name: m.name }));

  const refreshRows = useCallback(async () => {
    const res = await fetch(
      `/api/work-orders?queue=${queue}&q=${encodeURIComponent(query)}`,
      { cache: 'no-store' }
    );
    const json = await res.json();
    setRows(Array.isArray(json?.rows) ? json.rows : []);
    setCounts({ ...EMPTY_COUNTS, ...(json?.counts || {}) });
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
  }, [queue, query]);

  const handleRowClick = useCallback((row: WorkOrderRow) => {
    // Toggle: clicking the active row closes the panel
    if (selectedId === row.id && isPanelOpen) {
      setIsPanelOpen(false);
      setSelectedId(null);
      return;
    }
    setSelectedId(row.id);
    setIsPanelOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set('entityType', row.entityType);
    params.set('entityId', String(row.entityId));
    router.replace(`/work-orders?${params.toString()}`);
  }, [selectedId, isPanelOpen, searchParams, router]);

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
    setSelectedId(null);
  }, []);

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
    // Only advance status when BOTH are now set
    const newStatus =
      newTechId && newPackerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status;

    // Optimistic update — UI moves immediately, reverts on error
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
      await refreshRows();
    } catch (err: any) {
      // Revert optimistic update on failure
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      window.alert(err?.message || 'Failed to assign staff');
    } finally {
      setSavingRowId(null);
    }
  };

  // Called by the assignment card when user finalises a single row's selection
  const handleAssignConfirm = useCallback(async (
    row: WorkOrderRow,
    { techId: newTechId, packerId: newPackerId, deadline, status: statusOverride }: import('./WorkOrderAssignmentCard').AssignmentConfirmPayload
  ) => {
    const newStatus =
      statusOverride ??
      (newTechId && newPackerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);

    // Optimistic update — also carry names so display is instant without waiting for refreshRows.
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
      // Only include assignedPackerId when it is explicitly being set/cleared.
      // Omitting it on tech-only partial saves prevents the API from null-wiping
      // a packer that was already saved to the PACK work-assignment.
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
      void refreshRows();
    } catch (err: any) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      window.alert(err?.message || 'Failed to assign staff');
    }
  }, [refreshRows]);

  // Match the API queue logic exactly:
  // `all_unassigned` means neither tech nor packer is assigned.
  const unassignedRows = rows.filter((r) => !r.techId && !r.packerId);
  const assignedRows = rows.filter((r) => r.techId != null || r.packerId != null);


  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={mainStickyHeaderRowClass}>
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="text-[13px] font-black uppercase tracking-tight text-slate-900">
              {queue === 'stock_replenish' ? 'Stock Replenish' : 'Work Orders'}
            </h1>
            {queue !== 'stock_replenish' && (
              <span className="text-[11px] font-medium text-slate-400">
                {counts[queue] ?? rows.length}
                {query ? ` · "${query}"` : ''}
              </span>
            )}
          </div>
          {queue !== 'stock_replenish' && (
            <div className="flex shrink-0 items-center gap-4">
              {unassignedRows.length > 0 && (
                <span className="text-[10px] font-black uppercase tracking-wider text-orange-500">
                  {unassignedRows.length} unassigned
                </span>
              )}
              {assignedRows.length > 0 && (
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
                  {assignedRows.length} assigned
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stock Replenish — search-then-assign panel (never loads all SKUs) */}
      {queue === 'stock_replenish' ? (
        <SkuStockAssignPanel technicianOptions={technicianOptions} packerOptions={packerOptions} />
      ) : (
        /* Table body — all other queues */
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <p className="text-sm font-medium italic text-gray-400 opacity-40">
                No work orders in this queue
              </p>
            </div>
          ) : (
            <div className="flex flex-col w-full">

              {/* ── Unassigned section ── */}
              {unassignedRows.length > 0 && (
                <>
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-50"
                  >
                    <div className="h-px flex-1 bg-orange-200" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-orange-500">
                      {unassignedRows.length} unassigned
                    </span>
                    <div className="h-px flex-1 bg-orange-200" />
                  </motion.div>

                  {unassignedRows.map((row, i) => (
                    <WorkOrderTableRow
                      key={row.id}
                      row={row}
                      isSelected={selectedId === row.id}
                      getStaffName={getStaffName}
                      onClick={handleRowClick}
                      onOpenAssign={() => setAssigningState({ rows: unassignedRows, startIndex: i })}
                    />
                  ))}
                </>
              )}

              {/* ── Assigned section ── */}
              {assignedRows.length > 0 && (
                <>
                  {unassignedRows.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-50"
                    >
                      <div className="h-px flex-1 bg-emerald-200" />
                      <span className="text-[11px] font-black uppercase tracking-widest text-emerald-600">
                        {assignedRows.length} assigned
                      </span>
                      <div className="h-px flex-1 bg-emerald-200" />
                    </motion.div>
                  )}
                  {assignedRows.map((row) => (
                    <WorkOrderTableRow
                      key={row.id}
                      row={row}
                      isSelected={selectedId === row.id}
                      getStaffName={getStaffName}
                      onClick={handleRowClick}
                      onOpenAssign={() => setAssigningState({ rows: [row], startIndex: 0 })}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Slide-in details panel */}
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

      {/* Assignment overlay card */}
      <AnimatePresence>
        {assigningState && (
          <WorkOrderAssignmentCard
            key="assignment-card"
            rows={assigningState.rows}
            startIndex={assigningState.startIndex}
            technicianOptions={technicianOptions}
            packerOptions={packerOptions}
            onConfirm={handleAssignConfirm}
            onClose={() => setAssigningState(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row sub-component — mirrors OrderRecordsTable's row layout
// ─────────────────────────────────────────────────────────────────────────────

interface WorkOrderTableRowProps {
  row: WorkOrderRow;
  isSelected: boolean;
  getStaffName: (id: number | null | undefined) => string;
  onClick: (row: WorkOrderRow) => void;
  onOpenAssign: () => void;
}

function WorkOrderTableRow({
  row,
  isSelected,
  getStaffName,
  onClick,
  onOpenAssign,
}: WorkOrderTableRowProps) {
  const statusClass = STATUS_COLOR[row.status] || 'text-slate-600 bg-slate-100';
  // SKU_STOCK only needs a tech; all other types need both tech + packer
  const isUnassigned =
    row.entityType === 'SKU_STOCK' ? !row.techId : !row.techId || !row.packerId;

  const techName = row.techName || (row.techId ? getStaffName(row.techId) : null);
  const packerName = row.packerName || (row.packerId ? getStaffName(row.packerId) : null);
  const techTextClass = row.techId
    ? stationThemeColors[getStaffThemeById(row.techId, 'technician')].text
    : 'text-slate-400';
  const packerTextClass = row.packerId
    ? stationThemeColors[getStaffThemeById(row.packerId, 'packer')].text
    : 'text-slate-400';

  // Contextual subtitle: always show tech status; packer only for non-SKU entity types
  const techLabel = techName ?? (row.techId ? `Tech #${row.techId}` : 'Tech unassigned');
  const packerLabel =
    row.entityType === 'SKU_STOCK'
      ? null
      : row.techId
      ? (packerName ?? (row.packerId ? `Pack #${row.packerId}` : 'Packer unassigned'))
      : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      data-work-order-row-id={row.id}
      className={`border-b border-gray-50 cursor-pointer transition-colors ${
        isSelected ? 'bg-blue-50/70' : 'hover:bg-blue-50/30'
      }`}
    >
      {/* Main row — clickable to open panel */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(row)}
        onKeyDown={(e) => e.key === 'Enter' && onClick(row)}
        className="grid grid-cols-[1fr_auto] items-start gap-3 px-4 pt-3 pb-1"
      >
        {/* Left: title + subtitle */}
        <div className="min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Status badge — hide OPEN when no tech assigned (implied) */}
            {(row.techId || row.status !== 'OPEN') && (
              <span
                className={`inline-block text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${statusClass}`}
              >
                {row.status.replace('_', ' ')}
              </span>
            )}
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
              {row.queueLabel}
            </span>
            {row.stockLevel != null && (
              <span className="text-[8px] font-black text-red-500 uppercase tracking-wide">
                · Stock {row.stockLevel}
              </span>
            )}
          </div>

          {/* Title */}
          <p className="text-[12px] font-bold text-gray-900 truncate leading-snug">
            {row.title}
          </p>

          {/* Subtitle — tech · packer names from work_assignments + deadline */}
          <p className="text-[10px] font-bold uppercase tracking-widest truncate text-gray-400">
            <span className={techTextClass}>{techLabel}</span>
            {packerLabel ? (
              <>
                <span className="text-gray-300"> · </span>
                <span className={packerTextClass}>{packerLabel}</span>
              </>
            ) : null}
            {row.deadlineAt ? (
              <span className="text-gray-400"> · {formatDate(row.deadlineAt)}</span>
            ) : null}
          </p>
        </div>

        {/* Right: record label + priority + assign button */}
        <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
          <span className="text-[9px] font-black text-gray-500 uppercase tracking-wide">
            {row.recordLabel}
          </span>
          {row.priority < 100 && (
            <span className="text-[8px] font-black text-red-500">P{row.priority}</span>
          )}
          {/* Assign / Edit chip */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenAssign(); }}
            className={[
              'h-6 px-2 rounded-md text-[8px] font-black uppercase tracking-wider border transition-all',
              isUnassigned
                ? 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
            ].join(' ')}
          >
            {isUnassigned ? 'Assign' : 'Reassign'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
