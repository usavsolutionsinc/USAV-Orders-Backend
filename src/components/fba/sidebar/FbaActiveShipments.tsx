'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import { USAV_REFRESH_DATA, FBA_PRINT_SHIPPED, FBA_BOARD_INJECT_ITEM, FBA_BOARD_REMOVE_ITEMS, FBA_ACTIVE_SHIPMENTS_REFRESH, FBA_OPEN_SHIPMENT_EDITOR, FBA_SHIPMENT_EDITOR_ACTIVE } from '@/lib/fba/events';
import { shipmentItemToBoardItem } from '@/lib/fba/board-item';
import { patchFbaItem } from '@/lib/fba/patch';
import { useFbaEvent, useFbaEvents } from '@/components/fba/hooks/useFbaEvent';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { Package, Pencil } from '@/components/Icons';
import { FbaShipmentEditorForm } from '@/components/fba/sidebar/FbaShipmentEditorForm';
import { FbaTrackingGroupDisplay } from '@/components/fba/sidebar/FbaTrackingGroupDisplay';
import {
  ChevronToggle,
  sectionLabel,
  framerPresence,
  framerTransition,
  SkeletonList,
} from '@/design-system';
import { FbaSelectedLineRow } from '@/components/fba/sidebar/FbaSelectedLineRow';
import { FbaQtyDisplay } from '@/components/fba/sidebar/FbaQtyStepper';
import { FbaStatusBadge } from '@/components/fba/shared/FbaStatusBadge';
import type { StationTheme } from '@/utils/staff-colors';
import type {
  ActiveShipment,
  ShipmentCardItem,
  TrackingBundle,
} from '@/lib/fba/types';
import { FBA_BOARD_DND_TYPE, tryParseBoardDragPayload } from '@/lib/fba/board-drag';
import { toast } from '@/lib/toast';

function boardDragAllocatedQtyFromSnapshot(snapshot: {
  qty?: number;
  actual_qty?: number;
  expected_qty?: number;
}) {
  const fromStepper = snapshot.qty != null ? Math.floor(Number(snapshot.qty)) : NaN;
  if (Number.isFinite(fromStepper) && fromStepper > 0) return fromStepper;
  return Math.max(1, Number(snapshot.actual_qty) || Number(snapshot.expected_qty) || 1);
}

function typesHasBoardNativeDrag(event: React.DragEvent) {
  return [...(event.dataTransfer?.types ?? [])].includes(FBA_BOARD_DND_TYPE);
}

function TrackingGroup({
  bundle,
  shipmentId,
  amazonShipmentId,
  editable,
  stationTheme,
  onChanged,
}: {
  bundle: TrackingBundle;
  shipmentId: number;
  amazonShipmentId: string | null;
  editable: boolean;
  stationTheme: StationTheme;
  onChanged?: () => void;
}) {
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});
  const [boardStripDraggingOver, setBoardStripDraggingOver] = useState(false);

  const getQty = (item: ShipmentCardItem) => qtyOverrides[item.item_id] ?? item.expected_qty;

  const handleQtyChange = async (item: ShipmentCardItem, nextQty: number) => {
    if (nextQty <= 0) {
      const boardItem = shipmentItemToBoardItem(item, {
        id: shipmentId,
        shipment_ref: '',
        amazon_shipment_id: amazonShipmentId,
      });
      window.dispatchEvent(new CustomEvent(FBA_BOARD_INJECT_ITEM, { detail: boardItem }));
      patchFbaItem(shipmentId, item.item_id, { status: 'PACKED' }).catch(() => {});
      setQtyOverrides((prev) => {
        const c = { ...prev };
        delete c[item.item_id];
        return c;
      });
      onChanged?.();
      return;
    }
    setQtyOverrides((prev) => ({ ...prev, [item.item_id]: nextQty }));
  };

  const mergeBoardIntoBundleTracking = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      setBoardStripDraggingOver(false);
      if (!editable) return;
      e.preventDefault();

      const payload = tryParseBoardDragPayload(e.dataTransfer?.getData(FBA_BOARD_DND_TYPE));
      if (!payload?.items?.length) return;

      const forShipment = payload.items.filter((row) => Number(row.shipment_id) === shipmentId);
      if (forShipment.length === 0) {
        toast.error('Those lines belong to another shipment.');
        return;
      }

      const trackingRaw = bundle.tracking_number.trim();
      if (!trackingRaw) {
        toast.error('Set a UPS tracking number on this UPS row before dropping.');
        return;
      }

      const qtyByItem = new Map<number, number>();
      for (const bi of bundle.items) {
        const q = qtyOverrides[bi.item_id] ?? bi.expected_qty;
        if (q > 0) qtyByItem.set(bi.item_id, q);
      }

      for (const snap of forShipment) {
        const addQty = boardDragAllocatedQtyFromSnapshot(snap);
        qtyByItem.set(snap.item_id, (qtyByItem.get(snap.item_id) ?? 0) + addQty);
      }

      const allocations = [...qtyByItem.entries()].map(([shipment_item_id, quantity]) => ({
        shipment_item_id,
        quantity,
      }));

      try {
        const res = await fetch(fbaPaths.planTracking(shipmentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link_id: bundle.link_id,
            tracking_number: trackingRaw,
            carrier: (bundle.carrier || 'UPS').trim() || 'UPS',
            label: 'UPS',
            allocations,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to update bundle allocations');

        window.dispatchEvent(
          new CustomEvent(FBA_BOARD_REMOVE_ITEMS, {
            detail: forShipment.map((row) => row.item_id),
          }),
        );

        setQtyOverrides({});
        onChanged?.();
      } catch (err: any) {
        toast.error(err?.message || 'Drop failed — try again');
      }
    },
    [
      editable,
      bundle.carrier,
      bundle.items,
      bundle.link_id,
      bundle.tracking_number,
      onChanged,
      qtyOverrides,
      shipmentId,
    ],
  );

  const stripBoardDropHandlers = editable
    ? {
        draggingOver: boardStripDraggingOver,
        onDragEnter: (evt: React.DragEvent<HTMLDivElement>) => {
          if (!typesHasBoardNativeDrag(evt)) return;
          evt.preventDefault();
          setBoardStripDraggingOver(true);
        },
        onDragLeave: (evt: React.DragEvent<HTMLDivElement>) => {
          if (!(evt.currentTarget as HTMLElement).contains(evt.relatedTarget as Node)) {
            setBoardStripDraggingOver(false);
          }
        },
        onDragOver: (evt: React.DragEvent<HTMLDivElement>) => {
          if (!typesHasBoardNativeDrag(evt)) return;
          evt.preventDefault();
          evt.dataTransfer.dropEffect = 'copy';
        },
        onDrop: (evt: React.DragEvent<HTMLDivElement>) => {
          void mergeBoardIntoBundleTracking(evt);
        },
      }
    : undefined;

  const visibleItems = bundle.items.filter((i) => (qtyOverrides[i.item_id] ?? i.expected_qty) > 0);
  if (visibleItems.length === 0) return null;

  return (
    <FbaTrackingGroupDisplay
      bundle={bundle}
      items={visibleItems}
      stationTheme={stationTheme}
      editable={editable}
      getQty={getQty}
      onSetQty={(item, v) => void handleQtyChange(item, v)}
      onRemoveItem={(item) => void handleQtyChange(item, 0)}
      trackingStripBoardDrop={stripBoardDropHandlers}
    />
  );
}

function ActiveShipmentCard({
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent(FBA_OPEN_SHIPMENT_EDITOR, { detail: shipment }));
                    }}
                    className="inline-flex size-3 shrink-0 items-center justify-center rounded-sm text-purple-400 transition-colors hover:bg-purple-100/80 hover:text-purple-700"
                    aria-label="Edit shipment"
                    title="Edit shipment"
                  >
                    <Pencil className="pointer-events-none h-2 w-2 shrink-0" />
                  </button>
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

export function FbaActiveShipments({ stationTheme = 'green' }: { stationTheme?: StationTheme }) {
  const [shipments, setShipments] = useState<ActiveShipment[]>([]);
  const [recentShipped, setRecentShipped] = useState<ActiveShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [editingShipment, setEditingShipment] = useState<ActiveShipment | null>(null);

  useFbaEvent<ActiveShipment>(FBA_OPEN_SHIPMENT_EDITOR, (shipment) => {
    setEditingShipment(shipment);
  });

  // Broadcast editing state so the sidebar can hide welcome/scan bar
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(FBA_SHIPMENT_EDITOR_ACTIVE, { detail: !!editingShipment }));
    return () => {
      window.dispatchEvent(new CustomEvent(FBA_SHIPMENT_EDITOR_ACTIVE, { detail: false }));
    };
  }, [editingShipment]);

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Transform a raw API row into an ActiveShipment with bundles. */
  const parseShipment = useCallback((s: any, includeShipped: boolean): ActiveShipment => {
    const rawItems: any[] = Array.isArray(s.items) ? s.items : [];
    const rawTracking: any[] = Array.isArray(s.tracking) ? s.tracking : [];

    const itemById = new Map<number, ShipmentCardItem>();
    for (const i of rawItems) {
      if (!includeShipped && i.status === 'SHIPPED') continue;
      itemById.set(Number(i.id), {
        item_id: Number(i.id),
        fnsku: i.fnsku,
        display_title: i.display_title || i.product_title || i.fnsku,
        expected_qty: Number(i.expected_qty) || 0,
        actual_qty: Number(i.actual_qty) || 0,
        status: i.status,
        shipment_id: s.id,
      });
    }

    const bundles: TrackingBundle[] = [];
    for (const row of rawTracking) {
      const linkId = Number(row.link_id) || 0;
      const trackingNumber = String(row.tracking_number_raw || '').trim();
      const carrier = String(row.carrier || '').trim();
      if (!linkId || !trackingNumber) continue;

      const allocations = Array.isArray(row.allocations) ? row.allocations : [];
      const bundleItems: ShipmentCardItem[] = [];
      for (const alloc of allocations) {
        const itemId = Number(alloc.shipment_item_id);
        const item = itemById.get(itemId);
        if (!item) continue;
        bundleItems.push({
          ...item,
          expected_qty: Math.max(1, Number(alloc.qty) || 1),
          tracking_number: trackingNumber,
          tracking_carrier: carrier,
        });
      }

      if (bundleItems.length > 0) {
        bundles.push({ link_id: linkId, tracking_number: trackingNumber, carrier, items: bundleItems });
      }
    }

    const primary = bundles[0] ?? null;
    return {
      id: s.id,
      shipment_ref: s.shipment_ref,
      amazon_shipment_id: s.amazon_shipment_id || null,
      status: s.status,
      shipped_at: s.shipped_at || null,
      bundles,
      tracking_numbers: bundles.map((b) => ({ tracking_number: b.tracking_number, carrier: b.carrier })),
      tracking_link_id: primary?.link_id ?? null,
      tracking_number_raw: primary?.tracking_number ?? null,
      tracking_carrier: primary?.carrier ?? null,
      items: Array.from(itemById.values()),
    };
  }, []);

  const fetchShipments = useCallback(async () => {
    try {
      const res = await fetch(fbaPaths.activeWithDetails(), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed');

      const activeRaw: any[] = Array.isArray(data.active) ? data.active : [];
      const shippedRaw: any[] = Array.isArray(data.shipped) ? data.shipped : [];

      // Only show shipments that have tracking bundles with items
      const activeWithTracking = activeRaw
        .filter((s) => Array.isArray(s.tracking) && s.tracking.length > 0)
        .map((s) => parseShipment(s, false))
        .filter((s) => s.items.length > 0);
      setShipments(activeWithTracking);

      const shippedWithTracking = shippedRaw
        .filter((s) => Array.isArray(s.tracking) && s.tracking.length > 0)
        .map((s) => parseShipment(s, true))
        .filter((s) => s.items.length > 0);
      setRecentShipped(shippedWithTracking);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [parseShipment]);

  useEffect(() => { void fetchShipments(); }, [fetchShipments]);

  const refreshEvents = useMemo(
    () => [USAV_REFRESH_DATA, FBA_PRINT_SHIPPED, FBA_ACTIVE_SHIPMENTS_REFRESH] as const,
    [],
  );
  useFbaEvents(refreshEvents, () => void fetchShipments());

  if (loading) {
    return (
      <div className="space-y-3 px-3 py-4">
        <div className="h-4 w-32 bg-zinc-100 rounded animate-pulse mb-3" />
        <SkeletonList count={3} type="card" />
      </div>
    );
  }

  if (shipments.length === 0 && recentShipped.length === 0 && !editingShipment) return null;

  const emitChanged = () => {
    window.dispatchEvent(new CustomEvent(FBA_ACTIVE_SHIPMENTS_REFRESH));
    window.dispatchEvent(new CustomEvent(USAV_REFRESH_DATA));
  };

  // ── Editor form (replaces the card list while active) ──
  if (editingShipment) {
    return (
      <FbaShipmentEditorForm
        shipment={editingShipment}
        stationTheme={stationTheme}
        onClose={() => setEditingShipment(null)}
        onChanged={() => {
          setEditingShipment(null);
          emitChanged();
        }}
      />
    );
  }

  return (
    <div className="pb-4">
      <LayoutGroup id="fba-active-shipments">
        {shipments.map((shipment) => (
          <ActiveShipmentCard
            key={shipment.id}
            shipment={shipment}
            stationTheme={stationTheme}
            editable
            isExpanded={expandedIds.has(shipment.id)}
            onToggleExpand={() => toggleExpand(shipment.id)}
            onChanged={emitChanged}
          />
        ))}

        {recentShipped.length > 0 && (
          <div className="mt-6">
            <p className={`mb-3 px-4 ${sectionLabel} text-gray-500`}>Recent shipments</p>
            {recentShipped.map((shipment) => (
              <ActiveShipmentCard
                key={shipment.id}
                shipment={shipment}
                stationTheme={stationTheme}
                editable={false}
                isExpanded={expandedIds.has(shipment.id)}
                onToggleExpand={() => toggleExpand(shipment.id)}
                onChanged={emitChanged}
              />
            ))}
          </div>
        )}
      </LayoutGroup>
    </div>
  );
}
