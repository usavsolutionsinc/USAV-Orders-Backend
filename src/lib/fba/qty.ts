/**
 * Shared qty resolution utilities for FBA components.
 * Eliminates duplicate inline expressions across SelectionFloatingBar,
 * FbaWorkspaceScanField, FbaShipmentCard, and FbaSidebar.
 */

export interface FbaItemQtySource {
  actual_qty?: number | null;
  expected_qty?: number | null;
}

export interface FbaPlanQtySource {
  total_expected_qty?: number | null;
  total_items?: number | null;
}

/**
 * Resolves the display quantity for a single FBA shipment item.
 * - If actual_qty > 0: return actual_qty (already scanned/confirmed)
 * - Otherwise: return max(0, expected_qty - actual_qty) — units remaining to scan
 */
export function resolveFbaItemDisplayQty(item: FbaItemQtySource): number {
  const actual = Number(item.actual_qty || 0);
  const expected = Number(item.expected_qty || 0);
  if (actual > 0) return actual;
  return Math.max(0, expected - actual);
}

/**
 * Resolves the base qty for a FBA plan (shipment-level).
 * - If total_expected_qty > 0: return total_expected_qty
 * - Otherwise: return max(1, total_items)
 */
export function resolveFbaPlanQtyBase(plan: FbaPlanQtySource): number {
  const expectedQty = Number(plan.total_expected_qty || 0);
  const totalItems = Number(plan.total_items || 0);
  if (expectedQty > 0) return expectedQty;
  return Math.max(1, totalItems);
}
