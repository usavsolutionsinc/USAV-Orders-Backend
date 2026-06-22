'use client';

import { useCallback, useState } from 'react';
import { fbaPaths } from '@/lib/fba/api-paths';
import { FBA_BOARD_INJECT_ITEM, FBA_BOARD_REMOVE_ITEMS } from '@/lib/fba/events';
import { shipmentItemToBoardItem } from '@/lib/fba/board-item';
import { patchFbaItem } from '@/lib/fba/patch';
import { FbaTrackingGroupDisplay } from '@/components/fba/sidebar/FbaTrackingGroupDisplay';
import type { StationTheme } from '@/utils/staff-colors';
import type { ShipmentCardItem, TrackingBundle } from '@/lib/fba/types';
import { FBA_BOARD_DND_TYPE, tryParseBoardDragPayload } from '@/lib/fba/board-drag';
import { toast } from '@/lib/toast';
import { boardDragAllocatedQtyFromSnapshot, typesHasBoardNativeDrag } from './active-shipments-shared';

export function TrackingGroup({
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
