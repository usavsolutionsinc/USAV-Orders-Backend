import { FBA_BOARD_DND_TYPE } from '@/lib/fba/board-drag';
import type { ActiveShipment, ShipmentCardItem, TrackingBundle } from '@/lib/fba/types';

export function boardDragAllocatedQtyFromSnapshot(snapshot: {
  qty?: number;
  actual_qty?: number;
  expected_qty?: number;
}) {
  const fromStepper = snapshot.qty != null ? Math.floor(Number(snapshot.qty)) : NaN;
  if (Number.isFinite(fromStepper) && fromStepper > 0) return fromStepper;
  return Math.max(1, Number(snapshot.actual_qty) || Number(snapshot.expected_qty) || 1);
}

export function typesHasBoardNativeDrag(event: React.DragEvent) {
  return [...(event.dataTransfer?.types ?? [])].includes(FBA_BOARD_DND_TYPE);
}

/** Transform a raw API row into an ActiveShipment with bundles. */
export function parseShipment(s: any, includeShipped: boolean): ActiveShipment {
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
}
