export interface PairableItemRef {
  item_id: number;
  shipment_id: number | null | undefined;
}

export function getUniqueSelectedShipmentIds(items: PairableItemRef[]): number[] {
  const shipmentIds = new Set<number>();
  for (const item of items) {
    const shipmentId = Number(item.shipment_id || 0);
    if (Number.isFinite(shipmentId) && shipmentId > 0) {
      shipmentIds.add(shipmentId);
    }
  }
  return Array.from(shipmentIds);
}
