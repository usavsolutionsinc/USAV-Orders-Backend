'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, ClipboardList } from '@/components/Icons';
import { FnskuChip } from '@/components/ui/CopyChip';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import type { StationTheme } from '@/utils/staff-colors';
import { printQueueTableUi } from '@/utils/staff-colors';

export interface FbaBoardItem {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  item_notes: string | null;
  shipment_id: number;
  shipment_ref: string;
  amazon_shipment_id: string | null;
  due_date: string | null;
  shipment_status: string;
  destination_fc: string | null;
  tracking_numbers: { tracking_number: string; carrier: string; label: string }[];
  condition: string | null;
  shipment_ids?: number[];
}

interface FbaBoardTableProps {
  items: FbaBoardItem[];
  variant: 'board' | 'paired';
  stationTheme?: StationTheme;
  emptyMessage?: string;
  onSelectionChange?: (selected: FbaBoardItem[]) => void;
  onDetailOpen?: (item: FbaBoardItem) => void;
}

const STATUS_SORT_ORDER: Record<string, number> = {
  READY_TO_GO: 0,
  PACKING: 1,
  PLANNED: 2,
  OUT_OF_STOCK: 3,
  LABEL_ASSIGNED: 4,
  SHIPPED: 5,
};

function sortBoardItems(a: FbaBoardItem, b: FbaBoardItem) {
  const aOrder = STATUS_SORT_ORDER[a.item_status.toUpperCase()] ?? 99;
  const bOrder = STATUS_SORT_ORDER[b.item_status.toUpperCase()] ?? 99;
  if (aOrder !== bOrder) return aOrder - bOrder;

  const fa = a.fnsku.toUpperCase();
  const fb = b.fnsku.toUpperCase();
  if (fa !== fb) return fa.localeCompare(fb);

  return a.item_id - b.item_id;
}

export function FbaBoardTable({
  items,
  variant,
  stationTheme = 'green',
  emptyMessage,
  onSelectionChange,
  onDetailOpen,
}: FbaBoardTableProps) {
  const ui = printQueueTableUi[stationTheme];

  const sortedItems = useMemo(() => [...items].sort(sortBoardItems), [items]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const emitSelection = useCallback(
    (nextIds: Set<number>) => {
      onSelectionChange?.(sortedItems.filter((i) => nextIds.has(i.item_id)));
      window.dispatchEvent(
        new CustomEvent('fba-board-selection', {
          detail: sortedItems.filter((i) => nextIds.has(i.item_id)),
        }),
      );
    },
    [sortedItems, onSelectionChange],
  );

  useEffect(() => {
    // Defer dispatch to avoid setState-during-render in listening components (FbaSidebar)
    const id = requestAnimationFrame(() => {
      const qtyOrOne = (i: FbaBoardItem) => Math.max(1, Number(i.actual_qty || 0));
      const selectedQty = sortedItems
        .filter((i) => selectedIds.has(i.item_id))
        .reduce((sum, i) => sum + qtyOrOne(i), 0);
      const totalQty = sortedItems.reduce((sum, i) => sum + qtyOrOne(i), 0);
      window.dispatchEvent(
        new CustomEvent('fba-board-selection-count', {
          detail: { selected: selectedIds.size, total: sortedItems.length, selectedQty, totalQty },
        }),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [selectedIds, sortedItems]);

  const toggleItem = useCallback(
    (id: number) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        emitSelection(next);
        return next;
      });
    },
    [emitSelection],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<'all' | 'none'>).detail;
      if (action === 'all') {
        const next = new Set(sortedItems.map((i) => i.item_id));
        setSelectedIds(next);
        emitSelection(next);
      } else {
        setSelectedIds(new Set());
        emitSelection(new Set());
      }
    };
    window.addEventListener('fba-board-toggle-all', handler);

    // Select all items for a specific plan day (due_date)
    const selectByDayHandler = (e: Event) => {
      const dueDate = (e as CustomEvent<string>).detail;
      const dayItems = sortedItems.filter((i) => {
        const itemDay = i.due_date ? String(i.due_date).slice(0, 10) : '';
        return itemDay === dueDate;
      });
      if (dayItems.length === 0) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const i of dayItems) next.add(i.item_id);
        emitSelection(next);
        return next;
      });
    };
    window.addEventListener('fba-board-select-by-day', selectByDayHandler);

    const deselectByDayHandler = (e: Event) => {
      const dueDate = (e as CustomEvent<string>).detail;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const i of sortedItems) {
          const itemDay = i.due_date ? String(i.due_date).slice(0, 10) : '';
          if (itemDay === dueDate) next.delete(i.item_id);
        }
        emitSelection(next);
        return next;
      });
    };
    window.addEventListener('fba-board-deselect-by-day', deselectByDayHandler);

    const deselectHandler = (e: Event) => {
      const itemId = (e as CustomEvent<number>).detail;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        emitSelection(next);
        return next;
      });
    };
    window.addEventListener('fba-board-deselect-item', deselectHandler);

    const selectByFnskuHandler = (e: Event) => {
      const fnsku = String((e as CustomEvent<string>).detail || '').toUpperCase();
      if (!fnsku) return;
      const matching = sortedItems.filter((i) => i.fnsku.toUpperCase() === fnsku);
      if (matching.length === 0) {
        window.dispatchEvent(
          new CustomEvent('fba-board-fnsku-select-result', {
            detail: { fnsku, found: false, count: 0 },
          }),
        );
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const i of matching) next.add(i.item_id);
        emitSelection(next);
        return next;
      });
      window.dispatchEvent(
        new CustomEvent('fba-board-fnsku-select-result', {
          detail: { fnsku, found: true, count: matching.length, title: matching[0].display_title },
        }),
      );
    };
    window.addEventListener('fba-board-select-by-fnsku', selectByFnskuHandler);

    return () => {
      window.removeEventListener('fba-board-toggle-all', handler);
      window.removeEventListener('fba-board-deselect-item', deselectHandler);
      window.removeEventListener('fba-board-select-by-day', selectByDayHandler);
      window.removeEventListener('fba-board-deselect-by-day', deselectByDayHandler);
      window.removeEventListener('fba-board-select-by-fnsku', selectByFnskuHandler);
    };
  }, [sortedItems, emitSelection]);

  if (sortedItems.length === 0) {
    return (
      <div className="flex items-center justify-center px-4 py-12 text-center">
        <p className={sectionLabel}>
          {emptyMessage || 'No items'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="divide-y divide-gray-200">
        {sortedItems.map((item) => {
          const isSelected = selectedIds.has(item.item_id);
          return (
            <div
              key={item.item_id}
              role="button"
              tabIndex={0}
              onClick={() => toggleItem(item.item_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleItem(item.item_id);
                }
              }}
              className={[
                'grid min-h-[44px] cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 transition-colors',
                ui.rowFocusRing,
                isSelected ? ui.rowSelected : 'bg-white hover:bg-gray-50',
              ].join(' ')}
            >
              {/* Left: theme-aware checkbox — design system PrintTableCheckbox */}
              <div className="flex items-center justify-center pl-0.5">
                <PrintTableCheckbox
                  checked={isSelected}
                  onChange={() => toggleItem(item.item_id)}
                  stationTheme={stationTheme}
                  label={`${isSelected ? 'Deselect' : 'Select'} ${item.fnsku}`}
                />
              </div>

              {/* Center: title + qty/status row */}
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="whitespace-normal break-words text-[13px] font-bold leading-snug text-gray-900">
                  {item.display_title}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1 font-bold text-gray-600">
                    <ClipboardList className="h-3.5 w-3.5 text-purple-500" />
                    <span className="tabular-nums">{item.expected_qty}</span>
                  </span>
                  <span className="flex items-center gap-1 font-bold text-emerald-700">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="tabular-nums">{item.actual_qty}</span>
                  </span>
                  <StatusPill status={item.item_status} />
                  {item.condition && (
                    <span className="font-bold text-gray-500">{item.condition}</span>
                  )}
                </div>
              </div>

              {/* Right: fnsku chip + details button */}
              <div className="flex shrink-0 items-center gap-1.5">
                <FnskuChip value={item.fnsku} />
                {onDetailOpen && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDetailOpen(item);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    aria-label={`Details for ${item.fnsku}`}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_PILL_COLOR: Record<string, string> = {
  PLANNED: 'bg-amber-100 text-amber-700',
  PACKING: 'bg-blue-100 text-blue-700',
  READY_TO_GO: 'bg-emerald-100 text-emerald-700',
  OUT_OF_STOCK: 'bg-red-100 text-red-700',
  LABEL_ASSIGNED: 'bg-green-100 text-green-700',
};

function StatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const color = STATUS_PILL_COLOR[s] ?? 'bg-gray-100 text-gray-600';

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${color}`}>
      {s.replace(/_/g, ' ')}
    </span>
  );
}
