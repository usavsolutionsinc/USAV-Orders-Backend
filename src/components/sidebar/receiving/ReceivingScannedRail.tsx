'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { parseStaffParam } from '@/hooks/useStaffFilter';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { getReceivingStatusDot, getReceivingStatusDotLabel } from './ReceivingRecentRail';

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
  scope = 'triage',
}: {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  filterText?: string;
  limit?: number;
  /**
   * Which mode mounts this rail — triage's Prioritize tab or unbox's Queue
   * toggle. Scopes the query key so each mode owns its own cache entry and
   * one mode's in-flight/stale rows can never flash into the other.
   */
  scope?: 'triage' | 'unbox';
}) {
  const q = filterText.trim().toLowerCase();
  const searchParams = useSearchParams();
  const staffId = parseStaffParam(searchParams.get('staff'));
  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', 'scanned', scope, 'priority', q, staffId ?? 'all'] as const,
    [scope, q, staffId],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    params.set('view', 'scanned');
    if (staffId != null) params.set('staff', String(staffId));
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
      autoSelectFirstWhenEmpty
      getStatusDot={getReceivingStatusDot}
      getStatusDotLabel={getReceivingStatusDotLabel}
      // SCANNED semantics — NOT the unbox rail's Received count. Every row in the
      // view=scanned feed has quantity_received = 0 by definition (it drops out
      // the instant it's unboxed), so rendering quantity_received here always
      // read "0/N" — the bug. A door scan brings the WHOLE carton in physically,
      // so scanned == expected: a single-line PO reads "1/1". Falls back to 1/?
      // when the expected qty is unknown. This is what keeps the Prioritize tab
      // and the unbox Queue (both render this rail) on scanned, not unbox, logic.
      renderQuantity={(row) => {
        const expected = row.quantity_expected;
        return (
          <span className="text-gray-600">
            {expected ?? 1}/{expected ?? '?'}
          </span>
        );
      }}
      previewQtyLabel="Scanned"
      getPreviewQty={(row) => ({
        current: row.quantity_expected ?? 1,
        total: row.quantity_expected,
      })}
    />
  );
}
