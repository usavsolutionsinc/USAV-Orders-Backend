'use client';

/**
 * Triage "Triage" list — the combined working feed: Prioritize ∪ Unfound in ONE
 * list, newest-scanned first. This is the default triage view.
 *
 * Why combined: a carton must not jump out of the operator's list the instant
 * its PO is linked. The "Prioritize" tab (matched, priority-sorted) and the
 * "Unfound" tab (unmatched, no PO) are filtered SUBSETS of this list — linking a
 * PO moves a carton between those subsets, but on the Triage tab it simply stays
 * put (re-sorted by recency), so the operator keeps working what they just
 * scanned in without it disappearing.
 *
 * Composition, not a fork: the two sources are the EXACT same fetches the two
 * sub-tab rails use (so Triage = their union, never a divergent third query) —
 * `ReceivingScannedRail`'s `view=scanned&sort=priority` (minus unmatched) and
 * `TriageUnfoundList`'s `unfound-queue`. We merge + recency-sort in the fetcher,
 * then hand the result to the shared `RecentActivityRailBase`. Each source
 * degrades independently: if one fails, the other still lists.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { parseStaffParam } from '@/hooks/useStaffFilter';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { getReceivingStatusDot, getReceivingStatusDotLabel } from './ReceivingRecentRail';
import {
  toStubRow,
  matchesQuery as matchesUnfound,
  type UnfoundQueueRow,
} from './TriageUnfoundList';
import { matchesQuery as matchesScanned } from './ReceivingScannedRail';

/** Best-available recency for the combined sort (newest scanned first). */
function recencyMs(row: ReceivingLineRow): number {
  for (const c of [row.received_at, row.last_activity_at, row.scanned_at, row.created_at]) {
    if (!c) continue;
    const t = Date.parse(c);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

export function TriageCombinedList({
  selectedLineId,
  selectedRow = null,
  filterText = '',
}: {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  filterText?: string;
}) {
  const q = filterText.trim().toLowerCase();
  const searchParams = useSearchParams();
  const staffId = parseStaffParam(searchParams.get('staff'));
  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', 'triage-combined', q, staffId ?? 'all'] as const,
    [q, staffId],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    // Prioritize source — matched cartons at the dock, priority-sorted; mirror
    // ReceivingScannedRail (view=scanned, unmatched excluded, staff-scoped).
    const fetchScanned = async (): Promise<ReceivingLineRow[]> => {
      const params = new URLSearchParams({
        limit: '500',
        offset: '0',
        include: 'serials',
        view: 'scanned',
        sort: 'priority',
      });
      if (staffId != null) params.set('staff', String(staffId));
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('scanned fetch failed');
      const data = (await res.json()) as ApiResponse;
      return (data.receiving_lines ?? [])
        .filter((r) => r.receiving_source !== 'unmatched')
        .filter((r) => matchesScanned(r, q));
    };

    // Unfound source — unmatched cartons (no PO yet); mirror TriageUnfoundList.
    const fetchUnfound = async (): Promise<ReceivingLineRow[]> => {
      const res = await fetch(
        '/api/receiving/unfound-queue?kind=unmatched_receiving&checked=false&limit=200',
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('unfound queue fetch failed');
      const data = (await res.json()) as { rows?: UnfoundQueueRow[] };
      return (data.rows ?? [])
        .filter((r) => Number.isFinite(Number(r.source_id)))
        .filter((r) => matchesUnfound(r, q))
        .map(toStubRow);
    };

    // Degrade-not-fail: a failing source resolves empty so the other still lists.
    const [scanned, unfound] = await Promise.all([
      fetchScanned().catch(() => [] as ReceivingLineRow[]),
      fetchUnfound().catch(() => [] as ReceivingLineRow[]),
    ]);
    const merged = [...scanned, ...unfound].sort((a, b) => recencyMs(b) - recencyMs(a));
    return { success: true, receiving_lines: merged, total: merged.length };
  };

  return (
    <RecentActivityRailBase
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      limit={200}
      queryKey={queryKey}
      fetchFn={fetchFn}
      updateEvent="receiving-line-updated"
      deleteEvent="receiving-line-deleted"
      deleteGroupEvent="receiving-entry-deleted"
      refreshEvents={['receiving-entry-added', 'receiving-entry-deleted', 'usav-refresh-data']}
      eyebrowTitle="Triage"
      autoSelectFirstWhenEmpty
      getStatusDot={getReceivingStatusDot}
      getStatusDotLabel={getReceivingStatusDotLabel}
      // Unmatched stubs carry 0/? (nothing received yet); matched scanned cartons
      // arrived whole, so scanned == expected. Branch so each reads correctly.
      renderQuantity={(row) =>
        row.receiving_source === 'unmatched' ? (
          <span className="text-gray-600">
            {row.quantity_received}/{row.quantity_expected ?? '?'}
          </span>
        ) : (
          <span className="text-gray-600">
            {row.quantity_expected ?? 1}/{row.quantity_expected ?? '?'}
          </span>
        )
      }
      previewQtyLabel="Scanned"
      getPreviewQty={(row) =>
        row.receiving_source === 'unmatched'
          ? { current: row.quantity_received, total: row.quantity_expected }
          : { current: row.quantity_expected ?? 1, total: row.quantity_expected }
      }
    />
  );
}

export default TriageCombinedList;
