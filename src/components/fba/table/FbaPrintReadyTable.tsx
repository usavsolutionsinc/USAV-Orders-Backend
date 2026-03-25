'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from '@/components/Icons';
import WeekHeader from '@/components/ui/WeekHeader';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PrintTableCheckbox } from './Checkbox';
import { enrichFromApi } from './utils';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import type { EnrichedItem, PrintQueueItem, PrintSelectionPayload } from './types';

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

function planLabelForItem(item: EnrichedItem) {
  const ref = String(item.shipment_ref || '').trim();
  if (ref) return ref;
  return `Shipment ${item.shipment_id}`;
}

interface Props {
  refreshTrigger?: number | string;
  onSelectionChange?: (payload: PrintSelectionPayload) => void;
  fitHeightNoScroll?: boolean;
  staffId?: number | string | null;
}

function PrintReadyRow({
  item,
  isSelected,
  onClick,
}: {
  item: EnrichedItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5 border-b border-gray-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400 ${
        isSelected ? 'bg-indigo-50' : 'bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-center pt-0.5">
        <PrintTableCheckbox
          checked={isSelected}
          stationTheme="lightblue"
          reducedMotion={false}
          label={isSelected ? `Deselect ${item.fnsku}` : `Select ${item.fnsku}`}
          onChange={onClick}
        />
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-gray-900">
            {item.display_title || 'Untitled FNSKU'}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <span className={`tabular-nums ${item.expected_qty > 1 ? 'text-yellow-600' : ''}`}>{item.expected_qty}</span>
          </div>
        </div>
      </div>

      <div className="flex items-start justify-end gap-2 pt-0.5">
        <div className="flex shrink-0 items-center gap-1 text-[10px] font-mono text-gray-500">
          <Check className={`h-3 w-3 ${item.status === 'ready_to_print' ? 'text-emerald-600' : 'text-gray-400'}`} />
          <span>
            {item.actual_qty}/{item.expected_qty}
          </span>
        </div>
        <FnskuChip value={item.fnsku} width="w-[58px]" />
      </div>
    </div>
  );
}

export function FbaPrintReadyTable({
  refreshTrigger,
  onSelectionChange,
  fitHeightNoScroll = false,
  staffId = null,
}: Props) {
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [planFilter, setPlanFilter] = useState('all');
  const [weekOffset, setWeekOffset] = useState(0);

  const fetchPrintQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fba/print-queue', { cache: 'no-store' });
      const data = await res.json();
      const raw: PrintQueueItem[] = Array.isArray(data?.items) ? data.items : [];
      const enriched = raw.map((row) => enrichFromApi(row));
      setItems(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load print queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrintQueue();
  }, [fetchPrintQueue, refreshTrigger]);

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
    [weekEnd, weekStart]
  );

  const startKey = useMemo(() => toIsoDate(weekStart), [weekStart]);
  const endKey = useMemo(() => toIsoDate(weekEnd), [weekEnd]);

  const weekFilteredItems = useMemo(() => {
    return items.filter((item) => {
      const key = toPSTDateKey(item.due_date);
      if (!key) return true;
      return key >= startKey && key <= endKey;
    });
  }, [items, startKey, endKey]);

  const planOptions = useMemo(() => {
    const countMap = new Map<string, number>();
    weekFilteredItems.forEach((item) => {
      const label = planLabelForItem(item);
      countMap.set(label, (countMap.get(label) || 0) + 1);
    });
    const entries = Array.from(countMap.entries()).sort();
    return [
      { value: 'all', label: `All plans (${weekFilteredItems.length})` },
      ...entries.map(([label, count]) => ({ value: label, label: `${label} (${count})` })),
    ];
  }, [weekFilteredItems]);

  useEffect(() => {
    if (planFilter === 'all') return;
    if (planOptions.some((option) => option.value === planFilter)) return;
    setPlanFilter('all');
  }, [planFilter, planOptions]);

  const filteredItems = useMemo(() => {
    if (planFilter === 'all') return weekFilteredItems;
    return weekFilteredItems.filter((item) => planLabelForItem(item) === planFilter);
  }, [planFilter, weekFilteredItems]);

  const groupedByPlan = useMemo(() => {
    const map = new Map<string, EnrichedItem[]>();
    filteredItems.forEach((item) => {
      const label = planLabelForItem(item);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(item);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plan, entries]) => ({
        plan,
        items: entries,
      }));
  }, [filteredItems]);

  const headerDate = filteredItems[0]?.due_date ? String(filteredItems[0].due_date).slice(0, 10) : basePstKey;
  const totalCount = filteredItems.length;
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.item_id)), [items, selectedIds]);
  const selectedCount = selectedItems.length;

  useEffect(() => {
    const readyCount = selectedItems.filter((item) => item.status === 'ready_to_print').length;
    const pendingCount = selectedItems.filter(
      (item) => item.status === 'pending_out_of_stock' || item.status === 'pending_qc_fail'
    ).length;
    const needsPrintCount = selectedItems.filter((item) => item.status === 'needs_print').length;
    const payload: PrintSelectionPayload = {
      selectedItems,
      shipmentIds: Array.from(new Set(selectedItems.map((item) => item.shipment_id))),
      readyCount,
      pendingCount,
      needsPrintCount,
    };
    window.dispatchEvent(new CustomEvent('fba-print-selection', { detail: payload }));
    onSelectionChange?.(payload);
  }, [onSelectionChange, selectedItems]);

  const handleToggleSelection = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allVisibleSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.item_id));
  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredItems.forEach((item) => next.delete(item.item_id));
      } else {
        filteredItems.forEach((item) => next.add(item.item_id));
      }
      return next;
    });
  };

  const formatPlanHeader = useCallback((value: string) => value, []);
  const stationsAccent = staffId ? 'text-violet-700' : 'text-emerald-600';

  if (loading) {
    return (
      <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
          <p className="mt-3 text-xs font-black uppercase tracking-[0.2em] text-gray-700">Loading print-ready items…</p>
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
        rightSlot={
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-700">
            <select
              value={planFilter}
              onChange={(event) => setPlanFilter(event.target.value)}
              className="h-8 rounded-full border border-gray-200 bg-white px-3 text-[10px] font-black uppercase tracking-[0.2em] text-gray-700 shadow-sm"
            >
              {planOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSelectAll}
              className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-gray-700"
            >
              {allVisibleSelected ? 'Deselect all' : 'Select all'}
            </button>
            {selectedCount > 0 ? <span className="text-[10px] text-gray-500">{selectedCount} selected</span> : null}
          </div>
        }
      />

      <div className={`flex-1 ${fitHeightNoScroll ? 'overflow-hidden' : 'overflow-auto'} no-scrollbar`}>
        {groupedByPlan.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-20 text-center text-gray-500">
            <p className="text-xs font-black uppercase tracking-[0.3em]">No print-ready rows</p>
            <p className="mt-1 text-[11px]">Try a different week or plan.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {groupedByPlan.map((group) => (
              <div key={group.plan} className="flex flex-col">
                <DateGroupHeader
                  date={group.plan}
                  total={group.items.length}
                  formatDate={formatPlanHeader}
                />
                {group.items.map((item) => (
                  <PrintReadyRow
                    key={item.item_id}
                    item={item}
                    isSelected={selectedIds.has(item.item_id)}
                    onClick={() => handleToggleSelection(item.item_id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type { PrintQueueItem, PrintSelectionPayload } from './types';
