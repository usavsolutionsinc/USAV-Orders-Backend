/**
 * Central Orders Table Structure Definition
 * 
 * This file defines the canonical structure for the orders table.
 * Use this as the single source of truth for orders table schema.
 */

/**
 * Orders Table Structure
 * 
 * @field id - SERIAL PRIMARY KEY
 * @field order_id - TEXT
 * @field product_title - TEXT
 * @field condition - TEXT
 * @field shipping_tracking_number - TEXT
 * @field sku - TEXT
 * @field status - TEXT (derived from status_history)
 * @field status_history - JSONB (array of status changes with timestamps)
 * @field is_shipped - BOOLEAN NOT NULL DEFAULT false
 * @field ship_by_date - TEXT
 * @field packer_id - INTEGER (FK to staff.id - who is assigned)
 * @field notes - TEXT
 * @field quantity - TEXT DEFAULT 1
 * @field out_of_stock - TEXT
 * @field account_source - TEXT (eBay account, Amazon, etc.)
 * @field order_date - TIMESTAMP
 * @field tester_id - INTEGER (FK to staff.id - who tested the order)
 */

/**
 * Core order interface - matches database structure
 */
export interface OrderRecord {
  id: number;
  order_id: string | null;
  product_title: string | null;
  condition: string | null;
  shipping_tracking_number: string | null;
  sku: string | null;
  status_history: any; // JSONB - array of {status, timestamp, previous_status?}
  is_shipped: boolean;
  ship_by_date: string | null;
  packer_id: number | null;
  notes: string | null;
  quantity: string | null;
  out_of_stock: string | null;
  account_source: string | null;
  order_date: Date | null;
  tester_id: number | null;
}

/**
 * Extended order interface with computed/derived fields
 * Used for display and business logic
 */
export interface OrderWithDerived extends OrderRecord {
  status?: string; // Current status derived from status_history
  packed_by?: number | null; // FK to staff.id - who completed packing (from packer_logs)
  pack_date_time?: string | null; // Derived from packer_logs
  packer_photos_url?: any; // Derived from packer_logs (JSONB array)
  serial_number?: string; // Aggregated from tech_serial_numbers
  test_date_time?: string | null; // Derived from tech_serial_numbers
  tested_by_name?: string;
  packed_by_name?: string;
  tester_name?: string;
}

/**
 * Order table column names as constants
 * Use these for dynamic queries and updates
 */
export const ORDER_COLUMNS = {
  ID: 'id',
  ORDER_ID: 'order_id',
  PRODUCT_TITLE: 'product_title',
  CONDITION: 'condition',
  SHIPPING_TRACKING_NUMBER: 'shipping_tracking_number',
  SKU: 'sku',
  STATUS_HISTORY: 'status_history',
  IS_SHIPPED: 'is_shipped',
  SHIP_BY_DATE: 'ship_by_date',
  PACKER_ID: 'packer_id',
  NOTES: 'notes',
  QUANTITY: 'quantity',
  OUT_OF_STOCK: 'out_of_stock',
  ACCOUNT_SOURCE: 'account_source',
  ORDER_DATE: 'order_date',
  TESTER_ID: 'tester_id',
} as const;

/**
 * Fields that are allowed to be updated directly on orders table
 */
export const UPDATABLE_ORDER_FIELDS = [
  ORDER_COLUMNS.PACKER_ID,
  ORDER_COLUMNS.TESTER_ID,
  ORDER_COLUMNS.NOTES,
  ORDER_COLUMNS.IS_SHIPPED,
  ORDER_COLUMNS.STATUS_HISTORY,
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

/**
 * Migration notes:
 * 
 * REMOVED FIELDS (moved to other tables):
 * - packer_photos_url -> Now in packer_logs table
 * - pack_date_time -> Now in packer_logs table as pack_date_time
 * - packed_by -> Now in packer_logs table (completion tracking)
 * - serial_number -> Now in tech_serial_numbers table
 * - tested_by -> Derived from tech_serial_numbers.tester_id (first scan)
 * - test_date_time -> Derived from tech_serial_numbers.test_date_time (first scan)
 * 
 * ADDED FIELDS:
 * - tester_id -> INTEGER FK to staff.id (who is assigned to test)
 * 
 * RELATED TABLES:
 * - packer_logs: Tracks packing completion (packed_by, pack_date_time, packer_photos_url)
 * - tech_serial_numbers: Tracks serial numbers per order (serial_number, tester_id, test_date_time)
 * - staff: Staff members (id, name, role)
 */
