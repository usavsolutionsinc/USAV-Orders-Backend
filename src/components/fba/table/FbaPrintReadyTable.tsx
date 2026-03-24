'use client';

import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Loader2,
  Package,
  RefreshCw,
} from '@/components/Icons';
import { getTodayDateIso } from '@/components/fba/utils/getTodayDate';
import { PrintTableCheckbox } from './Checkbox';
import { DayBucketHeaderRow } from './DayBucketSection';
import { ItemRow } from './ItemRow';
import { createInitialTableState, printQueueReducer } from './printQueueReducer';
import type { EnrichedItem, PrintQueueItem, PrintSelectionPayload } from './types';
import { SelectionFloatingBar } from './SelectionFloatingBar';
import { ShipmentGroupHeaderRow } from './ShipmentGroupHeader';
import { UndoToast } from './UndoToast';
import { ViewToggle } from './ViewToggle';
import { dayKeyFromDue, enrichFromApi, groupByDayThenShipment, groupByShipmentOnly } from './utils';

export type { PrintQueueItem, PrintSelectionPayload } from './types';

function shiftLocalIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const tableVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.025, delayChildren: 0.05 } },
};

interface Props {
  refreshTrigger?: number | string;
  onSelectionChange?: (payload: PrintSelectionPayload) => void;
  /** Shipment IDs that have both Amazon FBA ID + UPS tracking captured in the sidebar */
  shipmentLabelReady?: Record<number, boolean>;
}

export function FbaPrintReadyTable({
  refreshTrigger,
  onSelectionChange,
  shipmentLabelReady = {},
}: Props) {
  const [state, dispatch] = useReducer(printQueueReducer, undefined, createInitialTableState);
  const shouldReduceMotion = useReducedMotion();
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [needsPrintTarget, setNeedsPrintTarget] = useState<EnrichedItem | null>(null);
  const [undoRemove, setUndoRemove] = useState<EnrichedItem | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const res = await fetch('/api/fba/print-queue', { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      const raw: PrintQueueItem[] = data.items ?? [];
      const enriched = raw.map((row) => enrichFromApi(row));
      dispatch({ type: 'SET_ITEMS', payload: enriched });
    } catch (e: unknown) {
      dispatch({
        type: 'SET_ERROR',
        error: e instanceof Error ? e.message : 'Network error',
      });
    }
  }, []);

  const refreshInPlace = useCallback(async () => {
    try {
      const res = await fetch('/api/fba/print-queue', { cache: 'no-store' });
      const data = await res.json();
      if (!data.success) return;
      const raw: PrintQueueItem[] = data.items ?? [];
      const enriched = raw.map((row) => enrichFromApi(row));
      dispatch({ type: 'REFRESH_ITEMS', payload: enriched });
    } catch {
      /* no-op */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTrigger]);

  useEffect(() => {
    const h = () => {
      void refreshInPlace();
    };
    window.addEventListener('fba-print-queue-refresh', h);
    return () => window.removeEventListener('fba-print-queue-refresh', h);
  }, [refreshInPlace]);

  useEffect(() => {
    const selectedItems = state.items.filter((i) => state.selected.has(i.item_id));
    const shipmentIds = Array.from(new Set(selectedItems.map((i) => i.shipment_id)));
    const readyCount = selectedItems.filter((i) => i.status === 'ready_to_print').length;
    const pendingCount = selectedItems.filter(
      (i) => i.status === 'pending_out_of_stock' || i.status === 'pending_qc_fail'
    ).length;
    const needsPrintCount = selectedItems.filter((i) => i.status === 'needs_print').length;
    const payload: PrintSelectionPayload = {
      selectedItems,
      shipmentIds,
      readyCount,
      pendingCount,
      needsPrintCount,
    };
    window.dispatchEvent(new CustomEvent('fba-print-selection', { detail: payload }));
    onSelectionChange?.(payload);
  }, [state.selected, state.items, onSelectionChange]);

  const visibleItems = useMemo(() => {
    if (!state.dayFilter) return state.items;
    return state.items.filter((i) => dayKeyFromDue(i.due_date) === state.dayFilter);
  }, [state.items, state.dayFilter]);

  const dayBuckets = useMemo(() => groupByDayThenShipment(visibleItems), [visibleItems]);
  const shipmentFlat = useMemo(() => groupByShipmentOnly(visibleItems), [visibleItems]);

  const allIds = useMemo(() => state.items.map((i) => i.item_id), [state.items]);
  const allChecked = allIds.length > 0 && allIds.every((id) => state.selected.has(id));
  const someChecked = !allChecked && allIds.some((id) => state.selected.has(id));

  const totalPlannedUnits = useMemo(
    () => visibleItems.reduce((sum, item) => sum + Math.max(0, Number(item.expected_qty) || 0), 0),
    [visibleItems]
  );
  const totalRemainingUnits = useMemo(
    () =>
      visibleItems.reduce(
        (sum, item) => sum + Math.max(0, Number(item.expected_qty) - Number(item.actual_qty)),
        0
      ),
    [visibleItems]
  );

  const toggleDay = (dayKey: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      next.has(dayKey) ? next.delete(dayKey) : next.add(dayKey);
      return next;
    });
  };

  const todayIso = getTodayDateIso();
  const yesterdayIso = shiftLocalIso(todayIso, -1);
  const tomorrowIso = shiftLocalIso(todayIso, 1);
  const pillButtonClass =
    'inline-flex h-8 items-center justify-center rounded-md border px-2 text-[10px] font-black uppercase tracking-[0.12em] transition-colors';
  const pillButtonIdleClass = 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50';
  const pillButtonActiveClass = 'border-sky-200 bg-sky-50 text-sky-900';

  const handleRefreshClick = () => {
    setRefreshSpin(true);
    void load().finally(() => {
      setTimeout(() => setRefreshSpin(false), 400);
    });
  };

  const cancelScheduledDelete = () => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
  };

  const commitDelete = async (item: EnrichedItem) => {
    try {
      const res = await fetch(`/api/fba/shipments/${item.shipment_id}/items/${item.item_id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success && !res.ok) {
        dispatch({ type: 'RESTORE_ITEM', item });
      }
    } catch {
      dispatch({ type: 'RESTORE_ITEM', item });
    }
  };

  const onRequestRemove = (item: EnrichedItem) => {
    cancelScheduledDelete();
    dispatch({ type: 'REMOVE_ITEM', id: item.item_id });
    setUndoRemove(item);
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      setUndoRemove(null);
      void commitDelete(item);
    }, 4000);
  };

  const onUndoRemove = () => {
    cancelScheduledDelete();
    if (undoRemove) {
      dispatch({ type: 'RESTORE_ITEM', item: undoRemove });
    }
    setUndoRemove(null);
  };

  const confirmNeedsPrint = async () => {
    if (!needsPrintTarget) return;
    const item = needsPrintTarget;
    setNeedsPrintTarget(null);
    dispatch({ type: 'PATCH_ITEM', id: item.item_id, patch: { status: 'needs_print', pending_reason: null } });
    try {
      const res = await fetch(`/api/fba/shipments/${item.shipment_id}/items/${item.item_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PACKING' }),
      });
      const data = await res.json();
      if (data.success && data.item) {
        const merged = {
          ...item,
          ...data.item,
          item_status: String(data.item.status ?? ''),
          item_notes: data.item.notes ?? item.item_notes,
        };
        dispatch({
          type: 'PATCH_ITEM',
          id: item.item_id,
          patch: { ...enrichFromApi(merged as PrintQueueItem & { status?: string }), expanded: item.expanded },
        });
      }
    } catch {
      void load();
    }
  };

  const daySummary = (groups: { items: EnrichedItem[] }[]) => {
    const items = groups.flatMap((g) => g.items);
    const n = items.length;
    const ready = items.filter((i) => i.status === 'ready_to_print').length;
    const pend = items.filter((i) => i.status === 'pending_out_of_stock' || i.status === 'pending_qc_fail').length;
    const needs = items.filter((i) => i.status === 'needs_print').length;
    const ships = groups.length;
    return `${n} item${n !== 1 ? 's' : ''} · ${ships} shipment${ships !== 1 ? 's' : ''} · ${ready} ready · ${needs} needs print · ${pend} pending`;
  };

  if (state.loading) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-3 bg-stone-50 px-6 text-zinc-500">
        <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 text-center shadow-sm shadow-zinc-200/70">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-sky-700" />
          <span className="mt-3 block text-sm font-semibold text-zinc-700">Loading print-ready shipments…</span>
          <span className="mt-1 block text-[11px] text-zinc-500">Refreshing the label queue and shipment groups.</span>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col items-center justify-center bg-stone-50 px-4 py-16">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white px-6 py-5 text-center shadow-sm shadow-red-100/70">
          <AlertCircle className="mx-auto h-[22px] w-[22px] text-red-600" />
          <p className="mt-3 text-sm font-semibold text-zinc-900">Couldn&apos;t load the print queue.</p>
          <p className="mt-1 text-xs text-zinc-500">{state.error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex rounded-full border border-red-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-700 transition-colors hover:bg-red-50"
          >
            Retry loading
          </button>
        </div>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-4 bg-stone-50 px-4 py-20 text-zinc-500"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-sky-100 bg-sky-50">
          <Package className="h-6 w-6 text-sky-400" />
        </div>
        <p className="text-sm font-semibold text-zinc-700">No items are waiting for label print.</p>
        <p className="max-w-[320px] text-center text-xs leading-5 text-zinc-500">
          Items appear here after a technician marks them <strong>Ready to Go</strong>.
        </p>
      </motion.div>
    );
  }

  const selectedItems = state.items.filter((i) => state.selected.has(i.item_id));

  return (
    <>
      <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-stone-50">
        <div className="shrink-0 border-b border-zinc-200 bg-white/95 px-3 py-2 backdrop-blur-sm sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-700">Print queue</p>
            </div>
            <div className="flex items-center gap-2">
              <ViewToggle
                value={state.viewMode}
                onChange={(mode) => dispatch({ type: 'SET_VIEW_MODE', mode })}
              />
              <button
                type="button"
                title="Refresh"
                onClick={handleRefreshClick}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-sky-300 hover:text-sky-700"
              >
                <motion.span
                  animate={{ rotate: refreshSpin ? 360 : 0 }}
                  transition={{ duration: 0.45, ease: 'easeInOut' }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </motion.span>
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-600">
            <PrintTableCheckbox
              checked={allChecked}
              indeterminate={someChecked}
              reducedMotion={Boolean(shouldReduceMotion)}
              label={allChecked ? 'Deselect all items' : 'Select all items'}
              onChange={() =>
                allChecked ? dispatch({ type: 'DESELECT_ALL' }) : dispatch({ type: 'SELECT_ALL' })
              }
            />
            <span className="inline-flex items-center gap-1 text-zinc-700" title="Groups">
              <Package className="h-3.5 w-3.5 text-sky-700" />
              {(() => {
                const g = state.viewMode === 'by_day' ? dayBuckets.length : shipmentFlat.length;
                return g;
              })()}
            </span>
            <span className="inline-flex items-center gap-1 text-zinc-700" title="Planned units">
              <ClipboardList className="h-3.5 w-3.5 text-zinc-500" />
              {totalPlannedUnits}
            </span>
            <span className="inline-flex items-center gap-1 text-zinc-700" title="Remaining units">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              {totalRemainingUnits}
            </span>

            {state.viewMode === 'by_day' ? (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className={`${pillButtonClass} w-8 px-0 ${state.dayFilter === null ? pillButtonActiveClass : pillButtonIdleClass}`}
                  onClick={() => dispatch({ type: 'SET_DAY_FILTER', date: null })}
                  aria-label="All days"
                  title="All days"
                >
                  <Calendar className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={`${pillButtonClass} w-8 px-0 ${state.dayFilter === yesterdayIso ? pillButtonActiveClass : pillButtonIdleClass}`}
                  onClick={() => dispatch({ type: 'SET_DAY_FILTER', date: yesterdayIso })}
                  aria-label="Yesterday"
                  title="Yesterday"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={`${pillButtonClass} w-8 px-0 ${state.dayFilter === todayIso ? pillButtonActiveClass : pillButtonIdleClass}`}
                  onClick={() => dispatch({ type: 'SET_DAY_FILTER', date: todayIso })}
                  aria-label="Today"
                  title="Today"
                >
                  <Clock className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className={`${pillButtonClass} w-8 px-0 ${state.dayFilter === tomorrowIso ? pillButtonActiveClass : pillButtonIdleClass}`}
                  onClick={() => dispatch({ type: 'SET_DAY_FILTER', date: tomorrowIso })}
                  aria-label="Tomorrow"
                  title="Tomorrow"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-white">
          <table className="w-full border-collapse text-sm">

            {state.viewMode === 'by_shipment' ? (
              <motion.tbody
                variants={shouldReduceMotion ? undefined : tableVariants}
                initial={shouldReduceMotion ? false : 'hidden'}
                animate={shouldReduceMotion ? undefined : 'visible'}
              >
                {shipmentFlat.map((group) => (
                  <Fragment key={group.shipment_id}>
                    <ShipmentGroupHeaderRow
                      group={group}
                      selected={state.selected}
                      dispatch={dispatch}
                      reducedMotion={Boolean(shouldReduceMotion)}
                      labelReady={Boolean(shipmentLabelReady[group.shipment_id])}
                    />
                {group.items.map((item) => (
                  <ItemRow
                    key={item.item_id}
                    item={item}
                    selected={state.selected}
                    dispatch={dispatch}
                    reducedMotion={Boolean(shouldReduceMotion)}
                    onRequestRemove={onRequestRemove}
                    onNeedsPrintClick={(row) => setNeedsPrintTarget(row)}
                  />
                ))}
                  </Fragment>
                ))}
              </motion.tbody>
            ) : (
              dayBuckets.map((bucket) => {
                const collapsed = collapsedDays.has(bucket.dayKey);
                return (
                  <motion.tbody
                    key={bucket.dayKey}
                    variants={shouldReduceMotion ? undefined : tableVariants}
                    initial={shouldReduceMotion ? false : 'hidden'}
                    animate={shouldReduceMotion ? undefined : 'visible'}
                  >
                    <DayBucketHeaderRow
                      label={bucket.label}
                      summary={daySummary(bucket.groups)}
                      collapsed={collapsed}
                      onToggle={() => toggleDay(bucket.dayKey)}
                      reducedMotion={Boolean(shouldReduceMotion)}
                    />
                    {!collapsed &&
                      bucket.groups.map((group) => (
                        <Fragment key={`${bucket.dayKey}-${group.shipment_id}`}>
                          <ShipmentGroupHeaderRow
                            group={group}
                            selected={state.selected}
                            dispatch={dispatch}
                            reducedMotion={Boolean(shouldReduceMotion)}
                            labelReady={Boolean(shipmentLabelReady[group.shipment_id])}
                          />
                          {group.items.map((item) => (
                            <ItemRow
                              key={item.item_id}
                              item={item}
                              selected={state.selected}
                              dispatch={dispatch}
                              reducedMotion={Boolean(shouldReduceMotion)}
                              onRequestRemove={onRequestRemove}
                              onNeedsPrintClick={(row) => setNeedsPrintTarget(row)}
                            />
                          ))}
                        </Fragment>
                      ))}
                  </motion.tbody>
                );
              })
            )}
          </table>
        </div>

        <AnimatePresence>
          {selectedItems.length > 0 && (
            <SelectionFloatingBar
              selectedItems={selectedItems}
              onClear={() => dispatch({ type: 'DESELECT_ALL' })}
            />
          )}
        </AnimatePresence>
      </div>

      <UndoToast
        open={undoRemove != null}
        label={undoRemove ? `${undoRemove.fnsku} removed from plan` : ''}
        onUndo={onUndoRemove}
      />

      <AnimatePresence>
        {needsPrintTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/35 p-4"
            role="presentation"
            onClick={() => setNeedsPrintTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-modal
              aria-labelledby="needs-print-title"
              onClick={(e) => e.stopPropagation()}
              className="max-w-sm rounded-3xl border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-900/10"
            >
              <p id="needs-print-title" className="text-sm font-black text-zinc-900">
                Mark as &quot;Needs Print&quot;?
              </p>
              <p className="mt-2 text-xs leading-5 text-zinc-600">
                Overrides the current status and sends this FNSKU back for re-labeling when a scan or print was missed.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNeedsPrintTarget(null)}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmNeedsPrint()}
                  className="rounded-full bg-sky-700 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-sky-800"
                >
                  Mark Needs Print →
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
