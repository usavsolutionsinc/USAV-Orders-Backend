/**
 * Factory for building FbaBoardItem objects from ShipmentCardItem data.
 *
 * Replaces manual inline construction that was duplicated in
 * FbaActiveShipments, StationFbaInput, and FbaShipmentCard.
 */

import type { FbaBoardItem, ShipmentCardItem, ActiveShipment } from './types';

/** Build a single FbaBoardItem from a ShipmentCardItem (e.g. returning an item to the board). */
export function shipmentItemToBoardItem(
  item: ShipmentCardItem,
  shipment: Pick<ActiveShipment, 'id' | 'shipment_ref' | 'amazon_shipment_id'>,
  overrides?: Partial<FbaBoardItem>,
): FbaBoardItem {
  return {
    item_id: item.item_id,
    fnsku: item.fnsku,
    expected_qty: item.expected_qty,
    actual_qty: item.actual_qty,
    item_status: overrides?.item_status ?? 'READY_TO_GO',
    display_title: item.display_title,
    asin: null,
    sku: null,
    item_notes: null,
    shipment_id: shipment.id,
    shipment_ref: shipment.shipment_ref,
    amazon_shipment_id: shipment.amazon_shipment_id,
    due_date: overrides?.due_date ?? new Date().toISOString().slice(0, 10),
    shipment_status: overrides?.shipment_status ?? 'PLANNED',
    destination_fc: null,
    tracking_numbers: [],
    condition: null,
    ...overrides,
  };
}

