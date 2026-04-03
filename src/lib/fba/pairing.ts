export interface PairableItemRef {
  item_id: number;
  shipment_id: number | null | undefined;
}

/** Extract unique plan IDs (fba_shipments.id) from selected items. */
export function getUniquePlanIds(items: PairableItemRef[]): number[] {
  const planIds = new Set<number>();
  for (const item of items) {
    const planId = Number(item.shipment_id || 0);
    if (Number.isFinite(planId) && planId > 0) {
      planIds.add(planId);
    }
  }
  return Array.from(planIds);
}

/** @deprecated Use `getUniquePlanIds` instead. */
export const getUniqueSelectedShipmentIds = getUniquePlanIds;
