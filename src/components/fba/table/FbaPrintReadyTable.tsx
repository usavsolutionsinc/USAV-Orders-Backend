'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from '@/components/Icons';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useFbaWorkspace } from '@/contexts/FbaWorkspaceContext';
import { getDbTableChannelName } from '@/lib/realtime/channels';
import WeekHeader from '@/components/ui/WeekHeader';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PrintTableCheckbox } from './Checkbox';
import { enrichFromApi, getPlanId, getPlanLabel } from './utils';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import type { EnrichedItem, PrintQueueItem, PrintSelectionPayload } from './types';

const FBA_SHIPMENTS_DB_CHANNEL = getDbTableChannelName('public', 'fba_shipments');
const FBA_SHIPMENT_ITEMS_DB_CHANNEL = getDbTableChannelName('public', 'fba_shipment_items');
const FBA_SHIPMENT_TRACKING_DB_CHANNEL = getDbTableChannelName('public', 'fba_shipment_tracking');

const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function calculateWeekStart(baseKey: string, offset: number) {
  const [year, month, day] = baseKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - dayOfWeek + offset * 7);
  return start;
}

const getRemainingQty = (item: EnrichedItem) =>
  Math.max(0, Number(item.expected_qty || 0) - Number(item.actual_qty || 0));

// Selection drives sidebar pairing, so only fully shipped rows stay locked.
const isSelectionLocked = (item: EnrichedItem) => {
  const status = String(item.item_status || '').toUpperCase();
  return status === 'SHIPPED';
};

interface Props {
  refreshTrigger?: number | string;
  onSelectionChange?: (payload: PrintSelectionPayload) => void;
  fitHeightNoScroll?: boolean;
  staffId?: number | string | null;
  activePlanId?: number | null;
}

interface PlanGroup {
  planId: number;
  plan: string;
  items: EnrichedItem[];
}

function PrintReadyRow({
  item,
  isSelected,
  selectable,
  onClick,
  displayExpectedQty,
  showExpectedQty = true,
}: {
  item: EnrichedItem;
  isSelected: boolean;
  selectable: boolean;
  onClick: () => void;
  displayExpectedQty?: number;
  showExpectedQty?: boolean;
}) {
  const expectedDisplay = displayExpectedQty ?? item.expected_qty;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={isSelected ? `Deselect ${item.fnsku}` : `Select ${item.fnsku}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-gray-300 px-3 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${
        isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-center">
        <PrintTableCheckbox
          checked={isSelected}
          stationTheme="lightblue"
          reducedMotion={false}
          disabled={!selectable}
          label={isSelected ? `Deselect ${item.fnsku}` : `Select ${item.fnsku}`}
          onChange={onClick}
        />
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-gray-900">{item.display_title || 'Untitled FNSKU'}</p>
        </div>
        <div className="mt-1 flex w-full min-w-0 flex-wrap items-center gap-2 text-[10px]">
          {showExpectedQty ? (
            <span
              className={`shrink-0 tabular-nums text-[10px] font-bold ${expectedDisplay > 1 ? 'text-yellow-600' : 'text-gray-700'}`}
            >
              {expectedDisplay}
            </span>
          ) : null}
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[13px] font-black text-gray-800">
            <Check className={`h-4 w-4 shrink-0 ${item.status === 'ready_to_print' ? 'text-emerald-600' : 'text-gray-500'}`} />
            <span className="tabular-nums">{item.actual_qty}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start justify-end pt-0.5">
        <FnskuChip value={item.fnsku} />
      </div>
    </div>
  );
}

function PrintQueueSection({
  items,
  selectedIds,
  onToggleSelection,
  firstRowIndexByShipment,
  allSelected,
  isIndeterminate,
  onToggleAll,
  selectedCount,
}: {
  items: EnrichedItem[];
  selectedIds: Set<number>;
  onToggleSelection: (item: EnrichedItem) => void;
  firstRowIndexByShipment: Map<number, number>;
  allSelected: boolean;
  isIndeterminate: boolean;
  onToggleAll: () => void;
  selectedCount: number;
}) {
  return (
    <>
      <div className="sticky top-0 z-20 border-y border-gray-300 bg-white px-3 py-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <motion.div whileTap={{ scale: 0.94 }} className="flex items-center justify-center">
              <PrintTableCheckbox
                checked={allSelected}
                indeterminate={isIndeterminate}
                onChange={onToggleAll}
                reducedMotion={false}
                stationTheme="lightblue"
                className="h-5 w-5"
                label={allSelected ? 'Deselect all print queue rows' : 'Select all print queue rows'}
              />
            </motion.div>
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">
              Print Queue ({items.length})
            </p>
          </div>
          {selectedCount > 0 ? (
            <span className="shrink-0 text-[10px] font-bold tabular-nums tracking-[0.08em] text-gray-500">
              {selectedCount} selected
            </span>
          ) : null}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="border-b border-gray-200 px-3 py-2 text-[11px] text-gray-500">Nothing in print queue for this week.</div>
      ) : null}
      {items.map((item, idx) => {
        const selectable = !isSelectionLocked(item);
        const firstIndex = firstRowIndexByShipment.get(item.plan_id);
        return (
          <div key={item.item_id} id={firstIndex === idx ? `print-plan-${item.plan_id}` : undefined}>
            <PrintReadyRow
              item={item}
              isSelected={selectedIds.has(item.item_id)}
              selectable={selectable}
              showExpectedQty={false}
              onClick={() => {
                if (!selectable) return;
                onToggleSelection(item);
              }}
            />
          </div>
        );
      })}
    </>
  );
}

function PlanGroupsSection({
  plannedByPlan,
  plannedItemsCount,
  selectedIds,
  expandedPlans,
  setExpandedPlans,
  onToggleSelection,
  onSetGroupSelection,
}: {
  plannedByPlan: PlanGroup[];
  plannedItemsCount: number;
  selectedIds: Set<number>;
  expandedPlans: Set<number>;
  setExpandedPlans: Dispatch<SetStateAction<Set<number>>>;
  onToggleSelection: (item: EnrichedItem) => void;
  onSetGroupSelection: (itemIds: number[], shouldSelect: boolean) => void;
}) {
  return (
    <>
      <div className="sticky top-0 z-20 border-y border-gray-300 bg-white px-3 py-1.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">
          Planned by Plan ({plannedItemsCount})
        </p>
      </div>
      {plannedByPlan.length === 0 ? (
        <div className="border-b border-gray-200 px-3 py-2 text-[11px] text-gray-500">No remaining units to pack in this week.</div>
      ) : null}
      {plannedByPlan.map((group) => {
        const selectableItems = group.items.filter((item) => !isSelectionLocked(item));
        const groupSelectedCount = selectableItems.reduce(
          (count, item) => count + (selectedIds.has(item.item_id) ? 1 : 0),
          0,
        );
        const groupAllSelected = selectableItems.length > 0 && groupSelectedCount === selectableItems.length;
        const groupIndeterminate = groupSelectedCount > 0 && !groupAllSelected;
        const isExpanded = expandedPlans.has(group.planId);

        const onToggleGroupSelection = () => {
          if (selectableItems.length === 0) return;
          onSetGroupSelection(
            selectableItems.map((item) => item.item_id),
            !groupAllSelected,
          );
        };

        const togglePlanExpanded = () => {
          setExpandedPlans((prev) => {
            const next = new Set(prev);
            if (next.has(group.planId)) next.delete(group.planId);
            else next.add(group.planId);
            return next;
          });
        };

        return (
          <div
            key={`planned-${group.planId}`}
            id={`planned-plan-${group.planId}`}
            className="flex flex-col"
          >
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${group.plan}` : `Expand ${group.plan}`}
              onClick={togglePlanExpanded}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  togglePlanExpanded();
                }
              }}
              className="z-10 flex w-full cursor-pointer items-center justify-between gap-2 border-y border-gray-200 bg-gray-50 px-3 py-1.5 text-left transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div
                  role="presentation"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleGroupSelection();
                  }}
                  className="flex shrink-0 items-center justify-center"
                >
                  <PrintTableCheckbox
                    checked={groupAllSelected}
                    indeterminate={groupIndeterminate}
                    stationTheme="lightblue"
                    reducedMotion={false}
                    disabled={selectableItems.length === 0}
                    label={groupAllSelected ? `Deselect all for ${group.plan}` : `Select all for ${group.plan}`}
                    onChange={onToggleGroupSelection}
                  />
                </div>
                <p className="min-w-0 truncate text-[13px] font-black uppercase tracking-[0.08em] text-gray-900">
                  {group.plan}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <motion.span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-600"
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ type: 'spring', stiffness: 440, damping: 30 }}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </motion.span>
                <p className="text-[11px] font-black tabular-nums text-gray-800">
                  {group.items.reduce((sum, item) => sum + getRemainingQty(item), 0)}
                </p>
              </div>
            </div>
            {isExpanded ? (
              <div id={`planned-plan-group-${group.planId}`}>
                {group.items.map((item) => {
                  const selectable = !isSelectionLocked(item);
                  return (
                    <PrintReadyRow
                      key={`planned-row-${item.item_id}`}
                      item={item}
                      isSelected={selectedIds.has(item.item_id)}
                      selectable={selectable}
                      showExpectedQty
                      displayExpectedQty={getRemainingQty(item)}
                      onClick={() => {
                        if (!selectable) return;
                        onToggleSelection(item);
                      }}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function FbaPrintReadyTable({
  refreshTrigger,
  onSelectionChange,
  fitHeightNoScroll = false,
  staffId = null,
  activePlanId = null,
}: Props) {
  const { clearSelection, clearSelectionVersion, setSelection } = useFbaWorkspace();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedPlans, setExpandedPlans] = useState<Set<number>>(new Set());
  const [weekOffset, setWeekOffset] = useState(0);
  const refreshTimeoutRef = useRef<number | null>(null);
  const seenPlanIdsRef = useRef<Set<number>>(new Set());
  const selectionOwnerRef = useRef(`fba-print-ready-${Math.random().toString(36).slice(2)}`);

  const scrollShipmentIntoView = useCallback((elementId: string) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const fetchPrintQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fba/print-queue?status=PLANNED,PACKING,READY_TO_GO,OUT_OF_STOCK,LABEL_ASSIGNED', {
        cache: 'no-store',
      });
      const data = await res.json();
      const raw: PrintQueueItem[] = Array.isArray(data?.items) ? data.items : [];
      setItems(raw.map((row) => enrichFromApi(row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load print queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      void fetchPrintQueue();
    }, 120);
  }, [fetchPrintQueue]);

  useEffect(() => {
    void fetchPrintQueue();
  }, [fetchPrintQueue, refreshTrigger]);

  useEffect(() => {
    window.addEventListener('fba-print-queue-refresh', scheduleRefresh);
    window.addEventListener('usav-refresh-data', scheduleRefresh);
    return () => {
      window.removeEventListener('fba-print-queue-refresh', scheduleRefresh);
      window.removeEventListener('usav-refresh-data', scheduleRefresh);
    };
  }, [scheduleRefresh]);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    },
    [],
  );

  useAblyChannel(FBA_SHIPMENT_ITEMS_DB_CHANNEL, 'db.row.changed', () => {
    scheduleRefresh();
  });

  useAblyChannel(FBA_SHIPMENTS_DB_CHANNEL, 'db.row.changed', () => {
    scheduleRefresh();
  });

  useAblyChannel(FBA_SHIPMENT_TRACKING_DB_CHANNEL, 'db.row.changed', () => {
    scheduleRefresh();
  });

  useEffect(() => {
    if (clearSelectionVersion === 0) return;
    setSelectedIds(new Set());
  }, [clearSelectionVersion]);

  useEffect(() => () => clearSelection(selectionOwnerRef.current), [clearSelection]);

  const basePstKey = useMemo(() => getCurrentPSTDateKey(), []);
  const weekStart = useMemo(() => calculateWeekStart(basePstKey, weekOffset), [basePstKey, weekOffset]);
  const weekEnd = useMemo(() => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 6);
    return next;
  }, [weekStart]);

  const weekRange = useMemo(
    () => ({
      startStr: formatDateWithOrdinal(toIsoDate(weekStart)),
      endStr: formatDateWithOrdinal(toIsoDate(weekEnd)),
    }),
    [weekStart, weekEnd],
  );

  const startKey = useMemo(() => toIsoDate(weekStart), [weekStart]);
  const endKey = useMemo(() => toIsoDate(weekEnd), [weekEnd]);

  const weekFilteredItems = useMemo(
    () =>
      items.filter((item) => {
        const key = toPSTDateKey(item.due_date);
        if (!key) return true;
        return key >= startKey && key <= endKey;
      }),
    [items, startKey, endKey],
  );

  const filteredItems = useMemo(
    () => weekFilteredItems.filter((item) => String(item.item_status || '').toUpperCase() !== 'SHIPPED'),
    [weekFilteredItems],
  );

  const printQueueItems = useMemo(
    () =>
      filteredItems
        .filter((item) => Number(item.actual_qty || 0) >= 1)
        .sort((a, b) => {
          const dueA = a.due_date ? String(a.due_date) : '';
          const dueB = b.due_date ? String(b.due_date) : '';
          if (dueA !== dueB) return dueA.localeCompare(dueB);
          const planA = getPlanLabel(a);
          const planB = getPlanLabel(b);
          if (planA !== planB) return planA.localeCompare(planB);
          return String(a.fnsku).localeCompare(String(b.fnsku));
        }),
    [filteredItems],
  );

  const plannedItems = useMemo(
    () => filteredItems.filter((item) => getRemainingQty(item) > 0),
    [filteredItems],
  );

  const plannedByPlan = useMemo(() => {
    const map = new Map<number, PlanGroup>();
    plannedItems.forEach((item) => {
      const planId = getPlanId(item);
      const label = getPlanLabel(item);
      if (!map.has(planId)) {
        map.set(planId, {
          planId,
          plan: label,
          items: [],
        });
      }
      map.get(planId)!.items.push(item);
    });

    return Array.from(map.values())
      .sort((a, b) => {
        const dueA = a.items[0]?.due_date ? String(a.items[0].due_date) : '';
        const dueB = b.items[0]?.due_date ? String(b.items[0].due_date) : '';
        if (dueA !== dueB) return dueA.localeCompare(dueB);
        return a.plan.localeCompare(b.plan);
      })
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => String(a.fnsku).localeCompare(String(b.fnsku))),
      }));
  }, [plannedItems]);

  useEffect(() => {
    let changed = false;
    const next = new Set(expandedPlans);

    plannedByPlan.forEach((group) => {
      if (seenPlanIdsRef.current.has(group.planId)) return;
      seenPlanIdsRef.current.add(group.planId);
      next.add(group.planId);
      changed = true;
    });

    if (changed) {
      setExpandedPlans(next);
    }
  }, [expandedPlans, plannedByPlan]);

  const printQueuePlanIds = useMemo(() => new Set(printQueueItems.map((item) => item.plan_id)), [printQueueItems]);
  const plannedPlanIds = useMemo(() => new Set(plannedByPlan.map((group) => group.planId)), [plannedByPlan]);

  useEffect(() => {
    if (!activePlanId) return;
    if (plannedPlanIds.has(activePlanId)) {
      setExpandedPlans((prev) => new Set([...Array.from(prev), activePlanId]));
      window.setTimeout(() => scrollShipmentIntoView(`planned-plan-${activePlanId}`), 25);
      return;
    }
    if (printQueuePlanIds.has(activePlanId)) {
      window.setTimeout(() => scrollShipmentIntoView(`print-plan-${activePlanId}`), 25);
    }
  }, [activePlanId, plannedPlanIds, printQueuePlanIds, scrollShipmentIntoView]);

  useEffect(() => {
    const onFocusPlan = (event: Event) => {
      const custom = event as CustomEvent<{ planId?: number; shipmentId?: number }>;
      const planId = Number(custom.detail?.planId ?? custom.detail?.shipmentId);
      if (!Number.isFinite(planId) || planId <= 0) return;
      if (plannedPlanIds.has(planId)) {
        setExpandedPlans((prev) => new Set([...Array.from(prev), planId]));
        window.setTimeout(() => scrollShipmentIntoView(`planned-plan-${planId}`), 25);
        return;
      }
      if (printQueuePlanIds.has(planId)) {
        window.setTimeout(() => scrollShipmentIntoView(`print-plan-${planId}`), 25);
      }
    };

    window.addEventListener('fba-print-focus-plan', onFocusPlan);
    return () => window.removeEventListener('fba-print-focus-plan', onFocusPlan);
  }, [plannedPlanIds, printQueuePlanIds, scrollShipmentIntoView]);

  const handleToggleSelection = useCallback((item: EnrichedItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.item_id)) next.delete(item.item_id);
      else next.add(item.item_id);
      return next;
    });
  }, []);

  const setGroupSelection = useCallback((itemIds: number[], shouldSelect: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shouldSelect) {
        itemIds.forEach((id) => next.add(id));
      } else {
        itemIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

  const printQueueSelectableIds = useMemo(
    () =>
      printQueueItems
        .filter((item) => !isSelectionLocked(item))
        .map((item) => item.item_id),
    [printQueueItems],
  );

  const printQueueSelectedCount = useMemo(
    () => printQueueSelectableIds.reduce((count, id) => count + (selectedIds.has(id) ? 1 : 0), 0),
    [printQueueSelectableIds, selectedIds],
  );

  const allPrintQueueSelected =
    printQueueSelectableIds.length > 0 && printQueueSelectedCount === printQueueSelectableIds.length;
  const printQueueIndeterminate = printQueueSelectedCount > 0 && !allPrintQueueSelected;

  const toggleAllPrintQueue = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPrintQueueSelected) {
        printQueueSelectableIds.forEach((id) => next.delete(id));
      } else {
        printQueueSelectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allPrintQueueSelected, printQueueSelectableIds]);

  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.item_id)), [items, selectedIds]);

  useEffect(() => {
    const readyCount = selectedItems.filter((item) => item.status === 'ready_to_print').length;
    const pendingCount = selectedItems.filter(
      (item) => item.status === 'pending_out_of_stock' || item.status === 'pending_qc_fail',
    ).length;
    const needsPrintCount = selectedItems.filter((item) => item.status === 'needs_print').length;
    const planIds = Array.from(new Set(selectedItems.map((item) => item.plan_id)));
    const payload: PrintSelectionPayload = {
      selectedItems,
      planIds,
      shipmentIds: planIds,
      readyCount,
      pendingCount,
      needsPrintCount,
    };

    setSelection(selectionOwnerRef.current, payload);
    onSelectionChange?.(payload);
  }, [onSelectionChange, selectedItems, setSelection]);

  const firstRowIndexByShipment = useMemo(() => {
    const map = new Map<number, number>();
    printQueueItems.forEach((item, idx) => {
      if (!map.has(item.plan_id)) map.set(item.plan_id, idx);
    });
    return map;
  }, [printQueueItems]);

  const headerDate = filteredItems[0]?.due_date ? String(filteredItems[0].due_date).slice(0, 10) : basePstKey;
  const totalCount = filteredItems.length;
  const selectedCount = selectedItems.length;
  const stationsAccent = staffId ? 'text-violet-700' : 'text-emerald-600';

  if (loading) {
    return (
      <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
          <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-gray-700">Loading print-ready items...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-gray-50">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-white px-6 py-5 text-center shadow-sm shadow-red-100/70">
          <p className="text-sm font-semibold text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => void fetchPrintQueue()}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-700 transition-colors hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <WeekHeader
        stickyDate={headerDate}
        fallbackDate={formatDateWithOrdinal(basePstKey)}
        count={totalCount}
        countClassName={stationsAccent}
        weekRange={weekRange}
        weekOffset={weekOffset}
        onPrevWeek={() => setWeekOffset((current) => current - 1)}
        onNextWeek={() => setWeekOffset((current) => Math.min(0, current + 1))}
        formatDate={formatDateWithOrdinal}
        showWeekControls
        highContrast
        rightSlot={
          selectedCount > 0 ? (
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
              <span className="text-[10px] font-bold tabular-nums tracking-[0.08em] text-gray-500">{selectedCount} selected</span>
            </div>
          ) : null
        }
      />

      <div className={`flex-1 ${fitHeightNoScroll ? 'overflow-hidden' : 'overflow-auto'}`}>
        {printQueueItems.length === 0 && plannedByPlan.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center text-gray-500">
            <p className="text-xs font-black uppercase tracking-[0.3em]">No items this week</p>
            <p className="mt-1 text-[11px]">Try a different week or plan.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            <PrintQueueSection
              items={printQueueItems}
              selectedIds={selectedIds}
              onToggleSelection={handleToggleSelection}
              firstRowIndexByShipment={firstRowIndexByShipment}
              allSelected={allPrintQueueSelected}
              isIndeterminate={printQueueIndeterminate}
              onToggleAll={toggleAllPrintQueue}
              selectedCount={printQueueSelectedCount}
            />
            <PlanGroupsSection
              plannedByPlan={plannedByPlan}
              plannedItemsCount={plannedItems.length}
              selectedIds={selectedIds}
              expandedPlans={expandedPlans}
              setExpandedPlans={setExpandedPlans}
              onToggleSelection={handleToggleSelection}
              onSetGroupSelection={setGroupSelection}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export type { PrintQueueItem, PrintSelectionPayload } from './types';



