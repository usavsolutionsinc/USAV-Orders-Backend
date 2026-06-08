export type ItemStatus =
  | 'ready_to_print'
  | 'needs_print'
  | 'pending_out_of_stock'
  | 'pending_qc_fail'
  | 'shipped';

export type PendingReason = 'out_of_stock' | 'qc_fail' | null;

export interface ShipmentTrackingEntry {
  link_id?: number;
  tracking_id?: number;
  tracking_number: string;
  carrier: string | null;
  status_category?: string | null;
  status_description?: string | null;
  is_delivered?: boolean | null;
  is_in_transit?: boolean | null;
  has_exception?: boolean | null;
  latest_event_at?: string | null;
  label?: string | null;
}

export interface PrintQueueItem {
  item_id: number;
  fnsku: string;
  expected_qty: number;
  actual_qty: number;
  item_status: string;
  display_title: string;
  asin: string | null;
  sku: string | null;
  /** Canonical internal `fba_shipments.id` used for plan selection + pairing. */
  plan_id?: number;
  /** Canonical human-facing plan code stored in `fba_shipments.shipment_ref`. */
  plan_ref?: string | null;
  /**
   * Legacy API alias for `plan_id`.
   * This is still the raw SQL column name from joins and is not Amazon's shipment id.
   */
  shipment_id: number;
  /** Legacy API alias for `plan_ref`. */
  shipment_ref: string;
  /** External Amazon FBA shipment id stamped onto a plan after pairing. */
  amazon_shipment_id: string | null;
  /** Carrier tracking rows linked to this plan. */
  tracking_numbers?: ShipmentTrackingEntry[] | null;
  due_date: string | null;
  destination_fc: string | null;
  item_notes?: string | null;
  pending_reason?: string | null;
  pending_reason_note?: string | null;
}

export interface EnrichedItem extends PrintQueueItem {
  plan_id: number;
  plan_ref: string;
  status: ItemStatus;
  pending_reason: PendingReason;
  pending_reason_note?: string;
  expanded: boolean;
}

export interface PrintSelectionPayload {
  selectedItems: EnrichedItem[];
  /** Canonical internal `fba_shipments.id` targets for sidebar pairing. */
  planIds: number[];
  readyCount: number;
  pendingCount: number;
  needsPrintCount: number;
}
