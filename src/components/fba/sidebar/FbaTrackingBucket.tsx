'use client';

import { useDroppable } from '@dnd-kit/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Trash2 } from '@/components/Icons';
import { FbaDraggableLineRow } from '@/components/fba/sidebar/FbaDraggableLineRow';
import { FbaQtyStepper } from '@/components/fba/sidebar/FbaQtyStepper';
import { emitOpenQuickAddFnsku } from '@/components/fba/FbaQuickAddFnskuModal';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { microBadge } from '@/design-system/tokens/typography/presets';
import type { FbaBoardItem } from '@/lib/fba/types';
import type { BucketAllocation, TrackingBucket } from '@/lib/fba/types';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';

interface FbaTrackingBucketProps {
  bucket: TrackingBucket;
  selectedItems: FbaBoardItem[];
  stationTheme: StationTheme;
  saving: boolean;
  onTrackingChange: (bucketId: string, value: string) => void;
  onQtyChange: (itemId: number, qty: number) => void;
  onRemoveItem: (item: FbaBoardItem) => void;
  onToggleCollapse: (bucketId: string) => void;
  onDelete: (bucketId: string) => void;
}

export function FbaTrackingBucket({
  bucket,
  selectedItems,
  stationTheme,
  saving,
  onTrackingChange,
  onQtyChange,
  onRemoveItem,
  onToggleCollapse,
  onDelete,
}: FbaTrackingBucketProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const { setNodeRef, isOver } = useDroppable({ id: `bucket-${bucket.bucketId}` });

  const itemMap = new Map(selectedItems.map((i) => [i.item_id, i]));
  const totalUnits = bucket.allocations.reduce((sum, a) => sum + a.qty, 0);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border transition-colors ${
        isOver
          ? 'border-dashed border-blue-400 bg-blue-50/40'
          : bucket.allocations.length > 0
            ? 'border-blue-200 bg-blue-50/20'
            : 'border-gray-200 bg-white'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => onToggleCollapse(bucket.bucketId)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:text-gray-600"
          aria-label={bucket.collapsed ? 'Expand box' : 'Collapse box'}
        >
          {bucket.collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </button>

        <input
          value={bucket.trackingNumber}
          onChange={(e) => onTrackingChange(bucket.bucketId, e.target.value.toUpperCase())}
          placeholder="1Z999AA10123456784"
          disabled={saving}
          className={`${chrome.monoInput} !py-1 !text-[10px] min-w-0 flex-1`}
          autoFocus={!bucket.trackingNumber}
        />

        <span className={`${microBadge} shrink-0 tabular-nums text-gray-400`}>
          {bucket.allocations.length > 0 ? `${bucket.allocations.length} · ${totalUnits}` : ''}
        </span>

        <button
          type="button"
          onClick={() => onDelete(bucket.bucketId)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
          aria-label="Delete this UPS box"
          title="Remove box (items return to unallocated)"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Collapsible items */}
      <AnimatePresence initial={false}>
        {!bucket.collapsed && (
          <motion.div
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.upNextCollapse}
            className="overflow-hidden"
          >
            {bucket.allocations.length === 0 ? (
              <div className="border-t border-gray-100 px-3 py-2">
                <p className={`${microBadge} text-center tracking-wider text-gray-400`}>
                  Drag items here
                </p>
              </div>
            ) : (
              <div className="border-t border-gray-100">
                {bucket.allocations.map((alloc) => {
                  const item = itemMap.get(alloc.item_id);
                  if (!item) return null;
                  return (
                    <FbaDraggableLineRow
                      key={alloc.item_id}
                      dragId={`draggable-${alloc.item_id}-bucket-${bucket.bucketId}`}
                      dragData={{ itemId: alloc.item_id, sourceContainer: `bucket-${bucket.bucketId}` }}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
