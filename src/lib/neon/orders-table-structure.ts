/**
 * Central Orders Table Structure Definition
 *
 * This file defines the canonical structure for the orders table.
 * Use this as the single source of truth for orders table schema.
 *
 * NOTE: tester_id and packer_id have been removed from the orders table.
 * Staff assignment is now tracked in the work_assignments table:
 *   - TEST assignments: work_assignments.assigned_tech_id
 *   - PACK assignments: work_assignments.assigned_packer_id
 * API responses that include tester_id / packer_id source those values
 * from work_assignments via lateral JOIN.
 */

/**
 * Core order interface - matches database structure.
 * tester_id / packer_id are omitted here; they appear on OrderWithDerived
 * when sourced from work_assignments by the API.
 */
export interface OrderRecord {
  id: number;
  order_id: string | null;
  product_title: string | null;
  condition: string | null;
  shipping_tracking_number: string | null;
  sku: string | null;
  status_history: any;
  is_shipped: boolean;
  ship_by_date: string | null;
  notes: string | null;
  quantity: string | null;
  customer_id: number | null;
  out_of_stock: string | null;
  account_source: string | null;
  order_date: Date | null;
}

/**
 * Extended order interface with computed / derived fields.
 * tester_id and packer_id are present here because API responses JOIN
 * work_assignments to provide backward-compatible assignment data.
 */
export interface OrderWithDerived extends OrderRecord {
  status?: string;
  /** Sourced from work_assignments (work_type=TEST, assigned_tech_id) */
  tester_id?: number | null;
  /** Sourced from work_assignments (work_type=PACK, assigned_packer_id) */
  packer_id?: number | null;
  packed_by?: number | null;
  pack_date_time?: string | null;
  packer_photos_url?: any;
  serial_number?: string;
  test_date_time?: string | null;
  tested_by_name?: string;
  packed_by_name?: string;
  tester_name?: string;
}

/**
 * Order table column names as constants.
 * Only columns that actually exist on the orders table are listed.
 */
export const ORDER_COLUMNS = {
  ID:                        'id',
  ORDER_ID:                  'order_id',
  PRODUCT_TITLE:             'product_title',
  CONDITION:                 'condition',
  SHIPPING_TRACKING_NUMBER:  'shipping_tracking_number',
  SKU:                       'sku',
  STATUS_HISTORY:            'status_history',
  IS_SHIPPED:                'is_shipped',
  SHIP_BY_DATE:              'ship_by_date',
  NOTES:                     'notes',
  QUANTITY:                  'quantity',
  CUSTOMER_ID:               'customer_id',
  OUT_OF_STOCK:              'out_of_stock',
  ACCOUNT_SOURCE:            'account_source',
  ORDER_DATE:                'order_date',
} as const;

/**
 * Fields allowed to be updated directly on the orders table.
 * Assignment fields (tester_id / packer_id) are intentionally excluded —
 * use POST /api/orders/assign which writes to work_assignments instead.
 */
export const UPDATABLE_ORDER_FIELDS = [
  ORDER_COLUMNS.NOTES,
  ORDER_COLUMNS.IS_SHIPPED,
  ORDER_COLUMNS.STATUS_HISTORY,
  ORDER_COLUMNS.CUSTOMER_ID,
  ORDER_COLUMNS.OUT_OF_STOCK,
  ORDER_COLUMNS.QUANTITY,
  ORDER_COLUMNS.CONDITION,
  ORDER_COLUMNS.SHIP_BY_DATE,
] as const;

/**
 * Get current status from status_history JSONB
 */
export function getCurrentStatus(statusHistory: any): string | null {
  if (!statusHistory) return null;
  try {
    const history = typeof statusHistory === 'string'
      ? JSON.parse(statusHistory)
      : statusHistory;
    if (Array.isArray(history) && history.length > 0) {
      return history[history.length - 1].status || null;
    }
  } catch (e) {
    console.error('Error parsing status_history:', e);
  }
  return null;
}
