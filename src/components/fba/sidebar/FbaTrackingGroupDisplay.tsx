'use client';

import { MapPin } from '@/components/Icons';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaQtyStepper, FbaQtyDisplay } from '@/components/fba/sidebar/FbaQtyStepper';
import { TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import type { StationTheme } from '@/utils/staff-colors';
import type { ShipmentCardItem, TrackingBundle } from '@/lib/fba/types';

export interface FbaTrackingGroupDisplayProps {
  bundle: TrackingBundle;
  items: ShipmentCardItem[];
  stationTheme: StationTheme;
  /** When true, the qty stepper is interactive (tech / sidebar edit mode). */
  editable?: boolean;
  /** Current qty for an item (applies overrides). */
  getQty?: (item: ShipmentCardItem) => number;
  /** Item-level checkbox state (tech card selection). Omit for pure display. */
  selectedIds?: Set<number>;
  /** Unchecking: toggles selection. Falls back to onRemoveItem if not provided. */
  onCheckedChange?: (itemId: number, next: boolean) => void;
  /** Used when the row checkbox is toggled off and no onCheckedChange given. */
  onRemoveItem?: (item: ShipmentCardItem) => void;
  onAdjustQty?: (item: ShipmentCardItem, delta: number) => void;
  onSetQty?: (item: ShipmentCardItem, qty: number) => void;
  /** When true, rows render with no leading checkbox column (read-only display). */
  hideCheckbox?: boolean;
}

/**
 * Shared display for a UPS tracking bundle + its FNSKU lines.
 * Used by both the active-shipments sidebar and the station up-next card
 * so the visual/format stays consistent with the editor (TrackingChip + FbaSelectedLineRow).
 */
export function FbaTrackingGroupDisplay({
  bundle,
  items,
  stationTheme,
  editable = false,
  getQty,
  selectedIds,
  onCheckedChange,
  onRemoveItem,
  onAdjustQty,
  onSetQty,
  hideCheckbox = false,
}: FbaTrackingGroupDisplayProps) {
  const resolveQty = (item: ShipmentCardItem) => (getQty ? getQty(item) : item.expected_qty);
  const totalQty = items.reduce((s, i) => s + resolveQty(i), 0);
  const tracking = (bundle.tracking_number || '').trim();

  if (items.length === 0) return null;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Tracking header — same visual as editor (TrackingChip) */}
      <div className="flex items-center gap-2 border-b border-blue-50 bg-blue-50/30 px-3 py-2">
        {tracking ? (
          <TrackingChip value={tracking} display={getLast4(tracking)} />
        ) : (
          <div className="flex items-center gap-1.5 text-blue-500">
            <MapPin className="h-3 w-3" />
            <span className="font-mono text-[11px] font-black">No tracking</span>
          </div>
        )}
        <span className="ml-auto shrink-0 text-[10px] font-black tabular-nums text-blue-400/80">
          {items.length} SKU{items.length !== 1 ? 's' : ''} · {totalQty} units
        </span>
      </div>

      <div className="divide-y divide-gray-50">
        {items.map((item) => {
          const qty = resolveQty(item);
          const isSelected = selectedIds ? selectedIds.has(item.item_id) : true;
          return (
            <FbaSelectedLineRow
              key={item.item_id}
              displayTitle={item.display_title || 'No title'}
              fnsku={String(item.fnsku || '').toUpperCase()}
              stationTheme={stationTheme}
              checked={isSelected}
              checkboxDisabled={!editable}
              hideCheckbox={hideCheckbox}
              onCheckedChange={(next) => {
                if (onCheckedChange) onCheckedChange(item.item_id, next);
                else if (!next && onRemoveItem) onRemoveItem(item);
              }}
              rightSlot={
                editable && (onSetQty || onAdjustQty) ? (
                  <FbaQtyStepper
                    value={qty}
                    onChange={(v) => {
                      if (onSetQty) onSetQty(item, v);
                      else if (onAdjustQty) onAdjustQty(item, v - qty);
                    }}
                    fnsku={item.fnsku}
                  />
                ) : (
                  <FbaQtyDisplay value={qty} />
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}
