'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { workflowStage, workflowStageDot } from '@/lib/receiving/workflow-stages';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/**
 * Color logic for the left status dot in Receiving view. Colors come from the
 * shared lifecycle registry (workflow-stages.ts) so the dot, the badge, and
 * every other surface agree. The one receiving-specific override: a line whose
 * received qty has met expected reads green even if the workflow hasn't been
 * advanced yet — "fully in" is the signal receivers scan for.
 */
export function getReceivingStatusDot(row: ReceivingLineRow): string {
  const { workflow_status: status, quantity_received: qtyReceived, quantity_expected: qtyExpected } = row;

  const stage = workflowStage(status);
  const qtyComplete =
    qtyExpected != null && qtyExpected > 0 && qtyReceived != null && qtyReceived >= qtyExpected;

  // Fully received but not in a terminal-fail state → green completeness cue.
  if (qtyComplete && stage.phase !== 'TERMINAL') return 'bg-emerald-500';
  return workflowStageDot(status);
}

interface Props {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  limit?: number;
}

/**
 * Sidebar "Recent activity" rail for the Receiving workspace.
 * Uses RecentActivityRailBase as a shell with Receiving-specific logic.
 */
export function ReceivingRecentRail({
  selectedLineId,
  selectedRow = null,
  limit = 25,
}: Props) {
  // 'rail' segment keeps this DISTINCT from ReceivingLinesTable's
  // ['receiving-lines-table', 'all', 'receive'] key (which caches the full
  // ApiResponse object, not the array) so the two queries can't share a cache
  // entry and feed each other the wrong shape. Still under the
  // ['receiving-lines-table'] prefix so broad invalidations refresh it.
  const queryKey = useMemo(() => ['receiving-lines-table', 'rail', 'activity', 'receive'] as const, []);

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    // 'activity' = lines that have actually been scanned/received. Excludes
    // untouched-incoming (EXPECTED, nothing received) so the rail shows what's
    // been worked, not what's still en route — those live in the Incoming view.
    params.set('view', 'activity');
    const res = await fetch(`/api/receiving-lines?${params.toString()}`);
    if (!res.ok) throw new Error('fetch failed');
    return res.json();
  };

  return (
    <RecentActivityRailBase
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      limit={limit}
      queryKey={queryKey}
      fetchFn={fetchFn}
      updateEvent="receiving-line-updated"
      refreshEvents={['receiving-entry-added', 'usav-refresh-data']}
      eyebrowTitle="Recent"
      eyebrowSuffix="Same as History"
      autoSelectFirstWhenEmpty
      getStatusDot={getReceivingStatusDot}
      renderQuantity={(row) => (
        <span className={
          row.quantity_expected != null && row.quantity_received >= row.quantity_expected 
            ? 'text-emerald-600' 
            : 'text-gray-600'
        }>
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
