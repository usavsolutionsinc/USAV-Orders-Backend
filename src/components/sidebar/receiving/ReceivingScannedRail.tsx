'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Loader2 } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/**
 * Eyebrow refresh: pulls the Zoho received-status (`zoho_po_mirror.status`) via
 * the same operator endpoint the Incoming tab uses, then refetches the scanned
 * list. A PO that Zoho now reports received drops off the list (the `scanned`
 * view's NOT_ZOHO_RECEIVED_PREDICATE guard takes effect on the next read).
 */
function ScannedZohoRefreshButton() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const onClick = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/receiving-lines/incoming/zoho-refresh', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await queryClient.invalidateQueries({ queryKey: ['receiving-lines-table', 'rail', 'scanned'] });
      toast.success('Synced Zoho received status');
    } catch {
      toast.error('Zoho sync failed');
    } finally {
      setSyncing(false);
    }
  }, [syncing, queryClient]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={syncing}
      title="Sync Zoho received status — clears POs Zoho marks received"
      // Keep the button's box no taller than the 9px/lh-1.2 eyebrow text so it
      // doesn't inflate the eyebrow row (which shoved "SCANNED · N" below the
      // UNFOUND eyebrow): no vertical padding, leading-none, smaller icon, and a
      // -my-0.5 safety bleed so the hover pill never grows the row height.
      className="-my-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0 text-[8.5px] font-black uppercase leading-none tracking-widest text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-600 disabled:opacity-50"
    >
      {syncing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
      {syncing ? 'Syncing' : 'Sync Zoho'}
    </button>
  );
}

/**
 * Triage "Found" rail — cartons door-scanned and physically in but NOT yet
 * unboxed (`view=scanned`). This is the to-do step BETWEEN the door scan and the
 * unbox workspace, so it is deliberately distinct from the unbox `view=activity`
 * rail (which shows what's already being unpacked). Unmatched cartons are
 * excluded here — they live in the parallel Unfound list.
 *
 * Reuses RecentActivityRailBase verbatim (selection highlight + hover preview),
 * so it looks and behaves exactly like the unbox rail; only the data view +
 * eyebrow differ.
 */

function matchesQuery(row: ReceivingLineRow, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.tracking_number,
    row.sku,
    row.item_name,
    row.zoho_purchaseorder_number,
    row.zoho_purchaseorder_id,
  ]
    .map((x) => (x || '').toLowerCase());
  return hay.some((h) => h.includes(q));
}

export function ReceivingScannedRail({
  selectedLineId,
  selectedRow = null,
  filterText = '',
  limit = 50,
}: {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  filterText?: string;
  limit?: number;
}) {
  const q = filterText.trim().toLowerCase();
  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', 'scanned', 'triage', 'priority', q] as const,
    [q],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    params.set('view', 'scanned');
    // Prioritize ordering: unfound/untagged first, then amazon → ebay → goodwill
    // (server-side rank on receiving.source_platform). This is the "Prioritize"
    // rail for both the triage tab and the unbox-mode toggle.
    params.set('sort', 'priority');
    const res = await fetch(`/api/receiving-lines?${params.toString()}`);
    if (!res.ok) throw new Error('fetch failed');
    const data = (await res.json()) as ApiResponse;
    const rows = (data.receiving_lines ?? [])
      .filter((r) => r.receiving_source !== 'unmatched')
      .filter((r) => matchesQuery(r, q));
    return { ...data, receiving_lines: rows };
  };

  return (
    <RecentActivityRailBase
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      limit={limit}
      queryKey={queryKey}
      fetchFn={fetchFn}
      updateEvent="receiving-line-updated"
      deleteEvent="receiving-line-deleted"
      deleteGroupEvent="receiving-entry-deleted"
      refreshEvents={['receiving-entry-added', 'receiving-entry-deleted', 'usav-refresh-data']}
      eyebrowTitle="Scanned"
      eyebrowAction={<ScannedZohoRefreshButton />}
      autoSelectFirstWhenEmpty
      // Awaiting unbox → blue dot; a partial qty (shouldn't happen in this view)
      // still reads green so a "fully in" carton is obvious.
      getStatusDot={(row) =>
        row.quantity_expected != null &&
        row.quantity_received >= row.quantity_expected &&
        row.quantity_expected > 0
          ? 'bg-emerald-500'
          : 'bg-blue-400'
      }
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

export default ReceivingScannedRail;
