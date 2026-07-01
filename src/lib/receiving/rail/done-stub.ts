/**
 * Shared mapping for `/api/receiving/triage/done` rows → the synthetic stub
 * `ReceivingLineRow` the Done-tab rail renders. Mirrors `unfound-stub.ts`'s
 * `toStubRow` pattern exactly — one place that produces the stub shape so the
 * Done list and the "Staged" badge (which reads the same endpoint) can never
 * disagree on what a staged carton looks like.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

export interface TriageDoneRow {
  id: number;
  zoho_purchaseorder_number: string | null;
  tracking_number: string | null;
  source_platform: string | null;
  source: string | null;
  staging_location_id: number | null;
  priority_lane: string | null;
  triage_completed_at: string;
  item_name: string | null;
  sku: string | null;
  photo_count?: number | string | null;
}

/** Map a `/triage/done` row to the stub ReceivingLineRow the rail renders. */
export function toDoneStubRow(r: TriageDoneRow): ReceivingLineRow {
  const receivingId = Number(r.id);
  return {
    id: -receivingId,
    receiving_id: receivingId,
    tracking_number: r.tracking_number,
    carrier: null,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: r.zoho_purchaseorder_number,
    item_name: r.item_name || r.zoho_purchaseorder_number || 'Staged carton',
    sku: r.sku,
    quantity_received: 0,
    quantity_expected: null,
    qa_status: 'PENDING',
    workflow_status: 'ARRIVED',
    disposition_code: 'HOLD',
    condition_grade: '',
    disposition_audit: [],
    needs_test: true,
    assigned_tech_id: null,
    zoho_sync_source: null,
    zoho_last_modified_time: null,
    zoho_synced_at: null,
    receiving_type: 'PO',
    notes: null,
    created_at: r.triage_completed_at,
    last_activity_at: r.triage_completed_at,
    image_url: null,
    source_platform: r.source_platform,
    receiving_source: r.source,
    staging_location_id: r.staging_location_id,
    priority_lane: r.priority_lane,
    triage_complete: true,
    triage_completed_at: r.triage_completed_at,
    photo_count: Number(r.photo_count ?? 0),
  };
}

export function matchesDoneQuery(r: TriageDoneRow, q: string): boolean {
  if (!q) return true;
  return [r.item_name, r.sku, r.zoho_purchaseorder_number, r.tracking_number].some((x) =>
    (x || '').toLowerCase().includes(q),
  );
}
