/** Types mirroring the /api/audit-log/receiving aggregator payload. */

export interface POSummary {
  po_id: string;
  po_number: string | null;
  vendor_name: string | null;
  line_count: number;
  carton_count: number;
  quantity_expected: number;
  quantity_received: number;
  workflow_counts: Record<string, number>;
  latest_event_at: string | null;
  last_actor_name: string | null;
}

export interface Photo {
  id: number;
  url: string;
  photo_type: string | null;
  taken_at: string;
  taken_by: number | null;
  taken_by_name: string | null;
}

export interface Carton {
  id: number;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
  received_at: string | null;
  received_by_name: string | null;
  unboxed_at: string | null;
  unboxed_by_name: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  is_return: boolean;
  return_platform: string | null;
  return_reason: string | null;
  target_channel: string | null;
  assigned_tech_name: string | null;
  zoho_purchase_receive_id: string | null;
  support_notes: string | null;
  photos: Photo[];
}

export interface Serial {
  id: number;
  serial_number: string;
  current_status: string | null;
  current_location: string | null;
  received_at: string | null;
  received_by_name: string | null;
}

export interface Line {
  id: number;
  receiving_id: number | null;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string;
  quantity_expected: number | null;
  quantity_received: number | null;
  workflow_status: string;
  qa_status: string;
  disposition_code: string;
  condition_grade: string;
  disposition_final: string | null;
  needs_test: boolean;
  assigned_tech_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  zoho_synced_at: string | null;
  serials: Serial[];
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  source: string;
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  receiving_id: number | null;
  receiving_line_id: number | null;
  serial_unit_id: number | null;
  serial_number: string | null;
  bin_id: number | null;
  bin_name: string | null;
  sku: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

export interface PODetail {
  po: { po_id: string; po_number: string | null; vendor_name: string | null };
  cartons: Carton[];
  lines: Line[];
  events: AuditEvent[];
}
