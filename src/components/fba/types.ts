/**
 * Canonical workflow modes derived from fba_fnsku_logs quantity rules.
 * PRINT_READY replaces the legacy READY_TO_GO alias used in older API responses.
 * Note: READY_TO_GO is still the DB enum for fba_shipment_items.status — this
 * type is only for the derived planning workflow state.
 */
export type FbaWorkflowMode = 'PLAN' | 'PACKING' | 'PRINT_READY' | 'NONE';

export interface FbaSummaryRow {
  fnsku: string;
  product_title: string | null;
  asin: string | null;
  sku: string | null;
  latest_serial_number?: string | null;
  is_active?: boolean;
  tech_scanned_qty: number;
  pack_ready_qty: number;
  shipped_qty: number;
  available_to_ship: number;
  currently_packing_qty?: number;
  ready_to_print_qty?: number;
  workflow_mode?: FbaWorkflowMode;
  last_event_at?: string | null;
  shipment_id?: number | null;
  amazon_shipment_id?: string | null;
  shipment_item_id?: number | null;
  shipment_ref: string | null;
  shipment_item_status: string | null;
  expected_qty: number | null;
  actual_qty: number | null;
}

export function getFbaCurrentlyPackingQty(row: FbaSummaryRow): number {
  const direct = Number(row.currently_packing_qty ?? NaN);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  return Math.max(0, Number(row.tech_scanned_qty || 0) - Number(row.pack_ready_qty || 0));
}

export function getFbaReadyToPrintQty(row: FbaSummaryRow): number {
  const direct = Number(row.ready_to_print_qty ?? NaN);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  return Math.max(0, Number(row.available_to_ship || 0));
}

export function deriveFbaWorkflowMode(row: FbaSummaryRow): FbaWorkflowMode {
  const fromApi = String(row.workflow_mode || '').toUpperCase();
  if (fromApi === 'PLAN' || fromApi === 'PACKING' || fromApi === 'PRINT_READY' || fromApi === 'NONE') {
    return fromApi as FbaWorkflowMode;
  }

  // Backward-compatible aliases from legacy API responses.
  if (fromApi === 'TESTED' || fromApi === 'PLANNED') return 'PLAN';
  if (fromApi === 'READY_TO_GO' || fromApi === 'READY_TO_PRINT') return 'PRINT_READY';
  if (fromApi === 'LABEL_ASSIGNED' || fromApi === 'SHIPPED') return 'PRINT_READY';

  // Fallback: derive from quantity fields when workflow_mode is absent.
  const readyToPrintQty = getFbaReadyToPrintQty(row);
  if (readyToPrintQty > 0) return 'PRINT_READY';
  if (getFbaCurrentlyPackingQty(row) > 0) return 'PACKING';
  if (Number(row.tech_scanned_qty || 0) > 0) return 'PLAN';
  return 'NONE';
}
