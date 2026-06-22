/**
 * `ReceivingDetailsLog` — the carton/receiving overlay shape rendered by
 * `ReceivingDetailsStack` and assembled by `lib/receiving/receiving-details-overlay`.
 *
 * Extracted out of `ReceivingDetailsStack.tsx` into this leaf module so the
 * type can be referenced without importing the component (which imports
 * `utils/events`, forming a cycle). `ReceivingDetailsStack` re-exports this
 * type for backwards compatibility.
 */
export interface ReceivingDetailsLog {
  id: string;
  timestamp: string;
  tracking?: string;
  status?: string;
  count?: number;
  qa_status?: string | null;
  disposition_code?: string | null;
  condition_grade?: string | null;
  is_return?: boolean;
  return_platform?: string | null;
  return_reason?: string | null;
  needs_test?: boolean;
  assigned_tech_id?: number | null;
  target_channel?: string | null;
  received_at?: string | null;
  received_by?: number | null;
  unboxed_at?: string | null;
  unboxed_by?: number | null;
  /** Earliest `receiving_scans` row for this carton (when present). */
  tracking_scanned_at?: string | null;
  tracking_scanned_by?: number | null;
  tracking_scanned_by_name?: string | null;
  unboxed_by_name?: string | null;
  received_by_name?: string | null;
  zoho_purchase_receive_id?: string | null;
  zoho_warehouse_id?: string | null;
  /** First-line Zoho PO linkage (merged in by receiving overlay fetch). */
  zoho_purchaseorder_id?: string | null;
  zoho_purchaseorder_number?: string | null;
  /** First-line listing URL when present. */
  listing_url?: string | null;
}
