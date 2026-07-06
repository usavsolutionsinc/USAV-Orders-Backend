'use client';

import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { Check, Loader2, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { OrderPreviewPanel } from './OrderPreviewPanel';
import { WorkspaceCard } from '@/design-system/components';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import type { Order } from '@/components/station/upnext/upnext-types';

interface ActiveOrderBodyProps {
  activeOrder: ActiveStationOrder;
  onRemoveSerial?: (serial: string, index: number) => Promise<void> | void;
  revealItem?: Variants;
}

function RevealSection({
  revealItem,
  children,
}: {
  revealItem?: Variants;
  children: ReactNode;
}) {
  if (revealItem) {
    return <motion.div variants={revealItem}>{children}</motion.div>;
  }
  return <>{children}</>;
}

/**
 * Hydrate an `ActiveStationOrder` into the `Order` shape consumed by
 * `OrderPreviewPanel` so the active surface reads identically to the
 * sidebar-click preview. Fields the preview never touches are filled with
 * inert defaults; nothing here is persisted.
 */
function activeOrderToOrderShape(activeOrder: ActiveStationOrder): Order {
  return {
    id: activeOrder.id ?? 0,
    ship_by_date: activeOrder.shipByDate ?? null,
    created_at: activeOrder.createdAt ?? null,
    order_id: activeOrder.orderId ?? '',
    product_title: activeOrder.productTitle ?? '',
    item_number: activeOrder.itemNumber ?? null,
    account_source: null,
    sku: activeOrder.sku ?? '',
    condition: activeOrder.condition ?? null,
    quantity: String(activeOrder.quantity ?? 1),
    status: 'active',
    shipping_tracking_number: activeOrder.tracking ?? '',
    out_of_stock: null,
  };
}

/**
 * Active-order right-pane body for /tech. Reuses `OrderPreviewPanel` exactly
 * so the surface looks identical to the sidebar-click preview, and appends
 * a serial list below that slides each scan in as it arrives.
 */
export function ActiveOrderBody({ activeOrder, onRemoveSerial, revealItem }: ActiveOrderBodyProps) {
  const previewOrder = useMemo(() => activeOrderToOrderShape(activeOrder), [activeOrder]);
  const quantity = Math.max(1, Number(activeOrder.quantity) || 1);

  /* ── SN slide-in + remove state ───────────────────────────────────────── */
  const [lastAddedSerial, setLastAddedSerial] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [serialError, setSerialError] = useState<string | null>(null);
  const prevTrackingRef = useRef(activeOrder.tracking);
  const prevSerialCountRef = useRef(activeOrder.serialNumbers.length);

  useEffect(() => {
    if (prevTrackingRef.current !== activeOrder.tracking) {
      prevTrackingRef.current = activeOrder.tracking;
      prevSerialCountRef.current = activeOrder.serialNumbers.length;
      setLastAddedSerial(null);
      return;
    }
    const prev = prevSerialCountRef.current;
    const current = activeOrder.serialNumbers.length;
    if (current > prev) {
      const newSerial = activeOrder.serialNumbers[current - 1];
      setLastAddedSerial(newSerial);
      const timer = setTimeout(() => setLastAddedSerial(null), 1800);
      prevSerialCountRef.current = current;
      return () => clearTimeout(timer);
    }
    prevSerialCountRef.current = current;
  }, [activeOrder.serialNumbers, activeOrder.tracking]);

  const handleRemoveSerial = async (serial: string, index: number) => {
    if (!onRemoveSerial || removingKey) return;
    setSerialError(null);
    const key = `${serial}-${index}`;
    setRemovingKey(key);
    try {
      await onRemoveSerial(serial, index);
    } catch (error) {
      setSerialError(error instanceof Error ? error.message : 'Failed to remove serial');
    } finally {
      setRemovingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <OrderPreviewPanel order={previewOrder} revealItem={revealItem} />

      <AnimatePresence initial={false}>
        {activeOrder.serialNumbers.length > 0 ? (
          <RevealSection revealItem={revealItem}>
            <motion.section
              key="active-serials"
              initial={framerPresence.collapseHeight.initial}
              animate={framerPresence.collapseHeight.animate}
              exit={framerPresence.collapseHeight.exit}
              transition={framerTransition.stationCollapse}
              className="overflow-hidden"
            >
              <WorkspaceCard label="Scanned serials" tone="emerald" bodyClassName="p-3">
                <div className="space-y-2">
                  <p className="text-eyebrow font-black uppercase tracking-wider text-emerald-700">
                    {activeOrder.serialNumbers.length}
                    {quantity > 1 ? ` / ${quantity}` : ''} captured
                  </p>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {activeOrder.serialNumbers.map((sn, index) => {
                    const isNew = sn === lastAddedSerial;
                    const isRemoving = removingKey === `${sn}-${index}`;
                    return (
                      <motion.div
                        key={`${sn}-${index}`}
                        initial={{ opacity: 0, x: 24, height: 0 }}
                        animate={{ opacity: 1, x: 0, height: 'auto' }}
                        exit={{ opacity: 0, x: -24, height: 0 }}
                        transition={framerTransition.stationSerialRow}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors duration-500 ${
                          isNew ? 'border-emerald-400 bg-emerald-200 shadow-sm' : 'border-emerald-100 bg-surface-card'
                        }`}
                      >
                        <Check className="h-3 w-3 flex-shrink-0 text-emerald-600" />
                        <span className="flex-1 font-mono text-xs font-bold text-emerald-700">{sn}</span>
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <AnimatePresence>
                            {isNew ? (
                              <motion.span
                                initial={framerPresence.stationAddedBadge.initial}
                                animate={framerPresence.stationAddedBadge.animate}
                                exit={framerPresence.stationAddedBadge.exit}
                                transition={framerTransition.stationAddedBadge}
                                className="text-eyebrow font-black uppercase tracking-wider text-emerald-600"
                              >
                                ✓ Added
                              </motion.span>
                            ) : null}
                          </AnimatePresence>
                          {onRemoveSerial ? (
                            <HoverTooltip label={`Remove serial ${sn}`} asChild>
                              <IconButton
                                icon={isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                onClick={() => void handleRemoveSerial(sn, index)}
                                disabled={Boolean(removingKey)}
                                ariaLabel={`Remove serial ${sn}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-emerald-500 hover:bg-red-50 hover:text-red-600"
                              />
                            </HoverTooltip>
                          ) : null}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
                  {serialError ? (
                    <p className="text-micro font-bold text-red-600">{serialError}</p>
                  ) : null}
                </div>
              </WorkspaceCard>
            </motion.section>
          </RevealSection>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
