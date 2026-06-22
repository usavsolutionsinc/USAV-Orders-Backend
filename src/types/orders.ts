// Leaf type-kernel for order rows. Dependency-free by design: low-layer modules
// (utils/*, hooks/*) import these row shapes WITHOUT pulling in the heavy
// query module (lib/neon/orders-queries → db). lib/neon/orders-queries
// re-exports ShippedOrder from here so its existing callers are unaffected.

export interface ShippedOrder {
  id: number;
  deadline_at?: string | null;
  ship_by_date?: string | null;
  order_id: string;
  product_title: string;
  quantity?: string | null;
  item_number?: string | null;
  condition: string;
  shipment_id?: number | string | null;
  shipping_tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  tracking_number_rows?: Array<{
    shipment_id: number | null;
    tracking: string;
    is_primary: boolean;
  }> | null;
  serial_number: string; // Aggregated from tech_serial_numbers
  sku: string;
  /** Staff ID assigned to test — sourced from work_assignments.assigned_tech_id */
  tester_id: number | null;
  tested_by: number | null;
  test_date_time: string | null;   // aliased from tsn.created_at
  test_activity_at?: string | null;
  next_test_activity_at?: string | null;
  /** Staff ID assigned to pack — sourced from work_assignments.assigned_packer_id */
  packer_id: number | null;
  packed_by: number | null;
  packed_at: string | null;        // packer_logs.created_at (scan timestamp)
  pack_activity_at?: string | null;
  /** SHIP_CONFIRM station_activity_logs.created_at — when it was scanned out at the dock. */
  ship_confirmed_at?: string | null;
  /** SHIP_CONFIRM station_activity_logs.staff_id — who scanned it out at the dock. */
  shipped_out_by?: number | null;
  shipped_out_by_name?: string | null;
  next_pack_activity_at?: string | null;
  pack_duration?: string | null;
  test_duration?: string | null;
  packer_photos_url: any;
  tracking_type: string | null;
  account_source: string | null;
  notes: string;
  sale_amount?: string | number | null;
  currency?: string | null;
  status_history: any;
  /** Derived from shipping_tracking_numbers carrier status — not stored on orders */
  is_shipped?: boolean;
  shipment_status?: string | null;
  latest_status_code?: string | null;
  latest_status_label?: string | null;
  latest_status_description?: string | null;
  latest_status_category?: string | null;
  is_delivered?: boolean;
  carrier?: string | null;
  latest_event_at?: string | null;
  has_exception?: boolean | null;
  exception_at?: string | null;
  is_terminal?: boolean | null;
  created_at: string | null;
  tested_by_name?: string | null;
  packed_by_name?: string | null;
  tester_name?: string | null;
  /** `packer_logs.id` for DELETE; from packerlogs API join. */
  packer_log_id?: number | null;
  /** `station_activity_logs.id` when delete has no packer_logs row (e.g. some FBA scans). */
  station_activity_log_id?: number | null;
  /** FK to customers — linked buyer (e.g. Amazon MFN shipping contact). */
  customer_id?: number | null;
  /** Amazon fulfillment channel: 'AFN' (FBA) | 'MFN'. Null for non-Amazon. */
  fulfillment_channel?: string | null;
  row_source?: 'order' | 'exception';
  exception_reason?: string | null;
  exception_status?: string | null;
  fnsku?: string | null;
  fnsku_log_id?: number | null;
  /** SAL row id — single source of truth anchor for this scan session. */
  sal_id?: number | null;
}
