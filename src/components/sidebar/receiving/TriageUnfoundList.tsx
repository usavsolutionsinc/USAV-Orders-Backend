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
 *
 * Two additive triage affordances live in the row's hover popover (via the
 * shared rail's optional `renderPopoverContext`/`renderPopoverActions` slots):
 *   • B3 — a read-only Zoho-sync exception dot + tooltip (retry count / last
 *     check / reason) pulled from the existing `/api/tracking-exceptions` feed,
 *     so staff see "Zoho still hasn't synced this PO" without leaving triage.
 *   • B2 — a "Claim" action that opens the existing `ReceivingClaimModal`
 *     (reused, not forked) for this carton, filed at the carton level since the
 *     unfound row is a synthetic stub with no real receiving_line.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import { Flag } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import {
  indexReceivingExceptions,
  exceptionDotClass,
  exceptionTooltipLabel,
  type ReceivingExceptionRow,
  type ReceivingExceptionContext,
} from '@/lib/receiving/triage-exception-context';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { getReceivingStatusDot, getReceivingStatusDotLabel } from './ReceivingRecentRail';

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

export function TriageUnfoundList({
  selectedLineId,
  filterText = '',
}: {
  selectedLineId: number | null;
  filterText?: string;
}) {
  const q = filterText.trim().toLowerCase();
  const queryKey = useMemo(() => ['receiving', 'triage', 'unfound-list', q] as const, [q]);

  // B3 — read-only exception context. Reuse the EXISTING receiving tracking-
  // exception feed (no new server view) and index it by receiving_id so each
  // unfound carton row can show "Zoho still hasn't synced this PO" as a dot +
  // tooltip. Degrades to no-dot on fetch failure (it's secondary context).
  const { data: exceptionMap } = useQuery<Map<number, ReceivingExceptionContext>>({
    queryKey: ['receiving', 'triage', 'open-exceptions'] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(
        '/api/tracking-exceptions?domain=receiving&status=open&limit=500',
        { cache: 'no-store' },
      );
      if (!res.ok) return new Map<number, ReceivingExceptionContext>();
      const data = (await res.json()) as { rows?: ReceivingExceptionRow[] };
      return indexReceivingExceptions(data.rows ?? []);
    },
  });

  // B2 — file a claim straight from the unfound row. The rail row is a synthetic
  // stub (negative id, no real receiving_line), so the claim is filed at the
  // CARTON level (lineIdOverride={null}); the modal auto-selects claimType
  // 'unfound' for unmatched rows with no PO.
  const [claimRow, setClaimRow] = useState<ReceivingLineRow | null>(null);

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
    <>
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
        autoSelectFirstWhenEmpty
        getStatusDot={getReceivingStatusDot}
        getStatusDotLabel={getReceivingStatusDotLabel}
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
        renderPopoverContext={(row) => {
          // B3: open Zoho-sync exception state for this carton (read-only).
          const ctx = row.receiving_id != null ? exceptionMap?.get(row.receiving_id) : undefined;
          if (!ctx) return null;
          return (
            <div className="flex items-center gap-2 border-t border-gray-100 pt-2.5">
              <HoverTooltip label={exceptionTooltipLabel(ctx)} asChild>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${exceptionDotClass(ctx)}`} />
                  <span className="text-eyebrow font-black uppercase tracking-widest text-gray-500">
                    Zoho sync pending · {ctx.retryCount}×
                  </span>
                </span>
              </HoverTooltip>
            </div>
          );
        }}
        renderPopoverActions={(row, { dismiss }) => (
          // B2: file a Zendesk claim for this unfound carton straight from triage.
          <HoverTooltip label="File a missing-carton / unfound claim for this package" asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setClaimRow(row);
                dismiss();
              }}
              className="h-auto gap-1 rounded-md px-2 py-1 text-micro font-black uppercase tracking-widest text-orange-600 hover:bg-orange-50"
            >
              <Flag className="h-3.5 w-3.5" />
              Claim
            </Button>
          </HoverTooltip>
        )}
      />

      {claimRow ? (
        <ReceivingClaimModal
          open
          row={claimRow}
          // Carton-level claim — the unfound stub has no real receiving_line.
          lineIdOverride={null}
          onClose={() => setClaimRow(null)}
          onTicketCreated={(tk) => {
            toast.success(`Claim filed — ${tk}`);
            setClaimRow(null);
            // Nudge the rail + dashboard to refetch (the cron resolves the
            // exception once Zoho syncs; the ticket # lands on the carton now).
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
          }}
        />
      ) : null}
    </>
  );
}
