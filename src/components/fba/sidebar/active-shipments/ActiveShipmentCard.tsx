'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Package, Pencil } from '@/components/Icons';
import { FBA_BOARD_INJECT_ITEM, FBA_OPEN_SHIPMENT_EDITOR } from '@/lib/fba/events';
import { shipmentItemToBoardItem } from '@/lib/fba/board-item';
import { patchFbaItem } from '@/lib/fba/patch';
import {
  ChevronToggle,
  framerPresence,
  framerTransition,
} from '@/design-system';
import { IconButton } from '@/design-system/primitives';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaQtyDisplay } from '@/components/fba/sidebar/FbaQtyStepper';
import { FbaStatusBadge } from '@/components/fba/shared/FbaStatusBadge';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { StationTheme } from '@/utils/staff-colors';
import type { ActiveShipment, ShipmentCardItem } from '@/lib/fba/types';
import { TrackingGroup } from './TrackingGroup';

export function ActiveShipmentCard({
  shipment,
  stationTheme,
  editable,
  isExpanded,
  onToggleExpand,
  onChanged,
}: {
  shipment: ActiveShipment;
  stationTheme: StationTheme;
  editable: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChanged?: () => void;
}) {
  const totalQty = shipment.items.reduce((s, i) => s + (Number(i.expected_qty) || 0), 0);
  const isShipped = shipment.status === 'SHIPPED';
  const shippedDateLabel = (() => {
    if (!shipment.shipped_at) return null;
    try {
      const d = new Date(shipment.shipped_at);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return null; }
  })();

  const primaryTracking = shipment.tracking_number_raw || shipment.tracking_numbers[0]?.tracking_number || 'No Tracking';

  /** Return a flat item (no tracking bundle) back to the board. */
  const handleReturnItem = (item: ShipmentCardItem) => {
    const boardItem = shipmentItemToBoardItem(item, {
      id: shipment.id,
      shipment_ref: shipment.shipment_ref,
      amazon_shipment_id: shipment.amazon_shipment_id,
    });
    window.dispatchEvent(new CustomEvent(FBA_BOARD_INJECT_ITEM, { detail: boardItem }));
    patchFbaItem(shipment.id, item.item_id, { status: 'PACKED' }).catch(() => {});
    onChanged?.();
  };

  const carrier = shipment.tracking_carrier || shipment.tracking_numbers[0]?.carrier || '';

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="[overflow:clip] border border-gray-200 bg-white transition-colors"
    >
      {/* ── Header (matches FbaShipmentCard layout) ── */}
      {/* role="button" (not <button>) so the inline Edit/Return controls below remain valid — a <button> cannot nest a <button>. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="flex w-full cursor-pointer items-center justify-between gap-2 bg-white px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Package className="h-4 w-4 shrink-0 text-purple-500" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="inline-flex min-w-0 max-w-full items-center gap-0.5 leading-none">
                <span className="truncate font-mono text-label font-black leading-none text-gray-900">
                  {shipment.amazon_shipment_id || shipment.shipment_ref}
                </span>
                {editable && (
                  <HoverTooltip label="Edit shipment" asChild focusable={false}>
                    <IconButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent(FBA_OPEN_SHIPMENT_EDITOR, { detail: shipment }));
                      }}
                      ariaLabel="Edit shipment"
                      icon={<Pencil className="pointer-events-none h-2 w-2 shrink-0" />}
                      className="inline-flex size-3 shrink-0 items-center justify-center rounded-sm text-purple-400 hover:bg-purple-100/80 hover:text-purple-700"
                    />
                  </HoverTooltip>
                )}
              </span>
              <span className="shrink-0 text-micro font-bold text-gray-400">
                {shipment.items.length} SKU · {totalQty} units
              </span>
              <FbaStatusBadge
                status={shipment.status}
                size="xs"
                iconOnly={
                  shipment.status === 'PLANNED' || shipment.status === 'TESTED' || shipment.status === 'PACKED'
                }
              />
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate font-mono text-micro font-bold text-gray-400">
                {shipment.tracking_numbers.length > 1
                  ? `${shipment.tracking_numbers.length} trackings`
                  : `${carrier ? `${carrier} · ` : ''}${primaryTracking}`}
              </p>
              {isShipped && shippedDateLabel ? (
                <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-eyebrow font-black text-emerald-700">
                  {shippedDateLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <ChevronToggle isExpanded={isExpanded} tone="purple" />
      </div>

      {/* ── Expanded: Tracking Groups + Items ── */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="expanded-shipment"
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.upNextCollapse}
            style={{ willChange: 'height, opacity' }}
            className="overflow-hidden"
          >
            <div className="border-t border-purple-100">
              {(() => {
                const hasBundles = (shipment.bundles?.length ?? 0) > 0;
                // Compute unallocated items: items not in any tracking bundle
                const allocatedIds = new Set<number>();
                if (hasBundles) {
                  for (const b of shipment.bundles) {
                    for (const bi of b.items) allocatedIds.add(bi.item_id);
                  }
                }
                const unallocatedItems = hasBundles
                  ? shipment.items.filter((i) => !allocatedIds.has(i.item_id))
                  : shipment.items;

                return (
                  <>
                    {unallocatedItems.length > 0 && (
                      <div className="divide-y divide-gray-50">
                        {hasBundles && (
                          <p className="px-2.5 py-1.5 text-eyebrow font-black uppercase tracking-widest text-gray-400">
                            Unallocated
                          </p>
                        )}
                        {unallocatedItems.map((item) => (
                          <FbaSelectedLineRow
                            key={item.item_id}
                            displayTitle={item.display_title || 'No title'}
                            fnsku={String(item.fnsku || '').toUpperCase()}
                            stationTheme={stationTheme}
                            checked
                            checkboxDisabled={!editable}
                            onCheckedChange={() => handleReturnItem(item)}
                            rightSlot={<FbaQtyDisplay value={item.expected_qty} />}
                          />
                        ))}
                      </div>
                    )}
                    {hasBundles &&
                      shipment.bundles.map((bundle) => (
                        <TrackingGroup
                          key={bundle.link_id}
                          bundle={bundle}
                          shipmentId={shipment.id}
                          amazonShipmentId={shipment.amazon_shipment_id}
                          editable={editable}
                          stationTheme={stationTheme}
                          onChanged={onChanged}
                        />
                      ))}
                  </>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
