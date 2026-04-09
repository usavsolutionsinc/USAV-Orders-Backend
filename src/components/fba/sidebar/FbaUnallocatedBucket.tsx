'use client';

import { useDroppable } from '@dnd-kit/core';
import { FbaDraggableLineRow } from '@/components/fba/sidebar/FbaDraggableLineRow';
import { FbaQtyStepper } from '@/components/fba/sidebar/FbaQtyStepper';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import type { FbaBoardItem } from '@/lib/fba/types';
import type { BucketAllocation } from '@/lib/fba/types';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import { microBadge } from '@/design-system/tokens/typography/presets';

interface FbaUnallocatedBucketProps {
  allocations: BucketAllocation[];
  selectedItems: FbaBoardItem[];
  stationTheme: StationTheme;
  onQtyChange: (itemId: number, qty: number) => void;
  onRemoveItem: (item: FbaBoardItem) => void;
}

export function FbaUnallocatedBucket({
  allocations,
  selectedItems,
  stationTheme,
  onQtyChange,
  onRemoveItem,
}: FbaUnallocatedBucketProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const { setNodeRef, isOver } = useDroppable({ id: 'unallocated' });

  const itemMap = new Map(selectedItems.map((i) => [i.item_id, i]));
  const totalUnits = allocations.reduce((sum, a) => sum + a.qty, 0);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-colors ${
        isOver
          ? 'border-dashed border-emerald-400 bg-emerald-50/40'
          : 'border-gray-200 bg-gray-50/30'
      }`}
    >
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <p className={`${microBadge} tracking-wider text-gray-500`}>Unallocated</p>
        {allocations.length > 0 && (
          <span className={`${microBadge} tabular-nums text-gray-400`}>
            {allocations.length} · {totalUnits}
          </span>
        )}
      </div>

      {allocations.length === 0 ? (
        <div className={`mx-2 mb-2 ${chrome.emptyShell}`}>
          <p className={`text-center text-[10px] font-semibold ${chrome.emptyLabel}`}>
            All items allocated to boxes
          </p>
        </div>
      ) : (
        <div className="border-t border-gray-100">
          {allocations.map((alloc) => {
            const item = itemMap.get(alloc.item_id);
            if (!item) return null;
            return (
              <FbaDraggableLineRow
                key={alloc.item_id}
                dragId={`draggable-${alloc.item_id}-unallocated`}
                dragData={{ itemId: alloc.item_id, sourceContainer: 'unallocated' }}
                displayTitle={item.display_title || 'No title'}
                fnsku={String(item.fnsku || '').toUpperCase()}
                stationTheme={stationTheme}
                checked
                onCheckedChange={(next) => { if (!next) onRemoveItem(item); }}
                onEditDetails={() =>
                  emitOpenQuickAddFnsku({
                    fnsku: String(item.fnsku || '').trim(),
                    product_title: item.display_title || null,
                    asin: item.asin ?? null,
                    sku: item.sku ?? null,
                    condition: item.condition ?? null,
                  })
                }
                rightSlot={
                  <FbaQtyStepper
                    value={alloc.qty}
                    fnsku={item.fnsku}
                    warnAbove={Math.max(1, Number(item.actual_qty || 0))}
                    onChange={(v) => {
                      if (v <= 0) { onRemoveItem(item); return; }
                      onQtyChange(alloc.item_id, v);
                    }}
                  />
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
