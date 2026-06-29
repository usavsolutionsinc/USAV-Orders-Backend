/**
 * Shared mapping for unfound-queue rows → the synthetic stub ReceivingLineRow
 * the receiving rails render. Single source of truth so every rail that lists
 * unfound cartons (triage Unfound, triage Combined, unbox Recent) produces the
 * EXACT same stub shape — title "Unfound PO", negative id, qty 0/?,
 * receiving_source 'unmatched', workflow ARRIVED ("SCANNED" chip).
 *
 * Lives in its own module (not in a rail component) to keep the rails free of a
 * circular import: ReceivingRecentRail owns the status-dot helpers that
 * TriageUnfoundList imports, and the unbox Recent rail in turn needs toStubRow —
 * so the stub mapping can't live in either of them.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

export interface UnfoundQueueRow {
  kind: string;
  source_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
  photo_count?: number | string | null;
}

/** Map an unfound-queue row to the stub ReceivingLineRow the rail renders. */
export function toStubRow(r: UnfoundQueueRow): ReceivingLineRow {
  const receivingId = Number(r.source_id);
  return {
    id: -receivingId,
    receiving_id: receivingId,
    tracking_number: r.context,
    carrier: null,
    zoho_item_id: null,
    zoho_line_item_id: null,
    zoho_purchase_receive_id: null,
    zoho_purchaseorder_id: null,
    zoho_purchaseorder_number: null,
    // Title shown in the rail row — "Unfound PO" (falls back to any product
    // title the queue captured).
    item_name: r.product_title || 'Unfound PO',
    sku: null,
    quantity_received: 0,
    quantity_expected: null,
    qa_status: 'PENDING',
    // Unfound = scanned at the dock but not matched to a PO → ARRIVED ("SCANNED"
    // chip), mirroring buildUnmatchedEmptyReceivingLine on the server. null here
    // fell back to the gray "EXPECTED" chip in the rail popover, which read as
    // "not here yet" for a carton that is physically in hand.
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
    created_at: r.created_at,
    last_activity_at: r.created_at,
    image_url: null,
    source_platform: null,
    receiving_source: 'unmatched',
    serials: r.serial_numbers
      ? r.serial_numbers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((serial_number, i) => ({ id: -(receivingId * 100 + i), serial_number }))
      : [],
    photo_count: Number(r.photo_count ?? 0),
  };
}

export function matchesQuery(r: UnfoundQueueRow, q: string): boolean {
  if (!q) return true;
  return [r.context, r.product_title, r.serial_numbers].some((x) =>
    (x || '').toLowerCase().includes(q),
  );
}
