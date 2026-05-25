import type { FbaBoardItem } from '@/lib/fba/types';

/** MIME type for HTML5 drag payload from sidebar rows / board table (combined review). */
export const FBA_BOARD_DND_TYPE = 'application/x-usav-fba-board-drag';

/** Row fields required to allocate onto an Active shipments tracking row via PATCH planTracking. */
export type FbaBoardDragRowSnapshot = Pick<
  FbaBoardItem,
  'item_id' | 'shipment_id' | 'expected_qty' | 'actual_qty' | 'fnsku'
>;

/** Minimal row payload — reconstruct full rows at drop targets if needed via refetch or ID validation. */
export interface FbaBoardDragPayloadV1 {
  v: 1;
  /** Per-line qty when dragging from combine-review steppers (optional; falls back to board actual/expected qty). */
  items: (FbaBoardDragRowSnapshot & { qty?: number })[];
}

export function buildBoardDragPayload(
  boards: ReadonlyArray<FbaBoardDragRowSnapshot & { qty?: number }>,
): string {
  const payload: FbaBoardDragPayloadV1 = { v: 1, items: [...boards] };
  return JSON.stringify(payload);
}

export function tryParseBoardDragPayload(raw: string | null | undefined): FbaBoardDragPayloadV1 | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as FbaBoardDragPayloadV1;
    if (!o || o.v !== 1 || !Array.isArray(o.items)) return null;
    const items = o.items.filter(
      (it) =>
        it &&
        Number.isFinite(Number(it.item_id)) &&
        Number(it.item_id) > 0 &&
        Number.isFinite(Number(it.shipment_id)),
    ) as (FbaBoardDragRowSnapshot & { qty?: number })[];
    if (items.length === 0) return null;
    return { v: 1, items };
  } catch {
    return null;
  }
}

/**
 * Resolve which sidebar rows participate in Active shipments HTML5 drag:
 * bucket ∩ selection, only if origin is in the bucket and in the selection snapshot.
 */
export function collectBoardRowsForActiveShipmentSidebarDrag(
  originItemId: number,
  sidebarBoardSnapshots: readonly (FbaBoardDragRowSnapshot & { qty?: number })[],
  bucketItemIds: ReadonlySet<number>,
): (FbaBoardDragRowSnapshot & { qty?: number })[] {
  if (!bucketItemIds.has(originItemId)) return [];
  if (!sidebarBoardSnapshots.some((r) => r.item_id === originItemId)) return [];
  return sidebarBoardSnapshots.filter((r) => bucketItemIds.has(r.item_id));
}
