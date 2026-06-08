'use client';

/**
 * Triage "Unfound" list — cartons scanned at the door that Zoho can't match to
 * a PO yet (`kind='unmatched_receiving'` in `v_unfound_queue`). Tap a row to
 * open it in the triage detail pane and add identifiable info (classify, add an
 * item, link a PO#). Rows auto-drop once Zoho syncs the PO or the operator links
 * one manually.
 *
 * Renders with the EXACT same components as the Found rail — it's a thin
 * RecentActivityRailBase wrapper. The unfound-queue rows are mapped to stub
 * ReceivingLineRows (titled "Unfound PO", qty 0/?), so the rail shows the same
 * row shape + selection highlight, and the hover preview shows the order# and
 * tracking number as last-4 copy chips (CopyChip) like every other rail.
 */

import { useMemo } from 'react';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { getReceivingStatusDot } from './ReceivingRecentRail';

interface UnfoundQueueRow {
  kind: string;
  source_id: string;
  product_title: string | null;
  serial_numbers: string | null;
  context: string | null;
  created_at: string;
}

/** Map an unfound-queue row to the stub ReceivingLineRow the rail renders. */
function toStubRow(r: UnfoundQueueRow): ReceivingLineRow {
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
  };
}

function matchesQuery(r: UnfoundQueueRow, q: string): boolean {
  if (!q) return true;
  return [r.context, r.product_title, r.serial_numbers].some((x) =>
    (x || '').toLowerCase().includes(q),
  );
}

export function TriageUnfoundList({
  selectedLineId,
  filterText = '',
}: {
  selectedLineId: number | null;
  filterText?: string;
}) {
  const q = filterText.trim().toLowerCase();
  const queryKey = useMemo(() => ['receiving', 'triage', 'unfound-list', q] as const, [q]);

  const fetchFn = async (): Promise<ApiResponse> => {
    const res = await fetch(
      '/api/receiving/unfound-queue?kind=unmatched_receiving&checked=false&limit=200',
      { cache: 'no-store' },
    );
    if (!res.ok) throw new Error('unfound queue fetch failed');
    const data = (await res.json()) as { rows?: UnfoundQueueRow[] };
    const rows = (data.rows ?? [])
      .filter((r) => Number.isFinite(Number(r.source_id)))
      .filter((r) => matchesQuery(r, q))
      .map(toStubRow);
    return { success: true, receiving_lines: rows, total: rows.length };
  };

  return (
    <RecentActivityRailBase
      selectedLineId={selectedLineId}
      selectedRow={null}
      limit={200}
      queryKey={queryKey}
      fetchFn={fetchFn}
      updateEvent="receiving-line-updated"
      deleteEvent="receiving-line-deleted"
      deleteGroupEvent="receiving-entry-deleted"
      refreshEvents={['receiving-entry-added', 'receiving-entry-deleted', 'usav-refresh-data']}
      eyebrowTitle="Unfound"
      eyebrowSuffix="To identify"
      autoSelectFirstWhenEmpty
      getStatusDot={getReceivingStatusDot}
      renderQuantity={(row) => (
        <span className="text-gray-600">
          {row.quantity_received}/{row.quantity_expected ?? '?'}
        </span>
      )}
      previewQtyLabel="Received"
      getPreviewQty={(row) => ({
        current: row.quantity_received,
        total: row.quantity_expected,
      })}
    />
  );
}
