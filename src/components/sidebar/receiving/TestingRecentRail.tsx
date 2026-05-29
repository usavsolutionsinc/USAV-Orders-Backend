'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { workflowStageDot } from '@/lib/receiving/workflow-stages';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/**
 * Color logic for the left status dot in Testing view. Colors come straight
 * from the shared lifecycle registry (workflow-stages.ts) so the testing flow
 * (awaiting → in-test → passed/failed) reads with the same per-stage hues as
 * everywhere else, rather than collapsing receipt states into one blue bucket.
 */
export function getTestingStatusDot(row: ReceivingLineRow): string {
  return workflowStageDot(row.workflow_status);
}

/** 
 * Computes "Tested" quantity based on workflow status. 
 * If the line is in a terminal state, we consider the full received quantity as tested.
 */
function getTestedQty(row: ReceivingLineRow): number {
  const v = String(row.workflow_status || '').trim().toUpperCase();
  const isTested = ['PASSED', 'DONE', 'FAILED', 'SCRAP', 'RTV'].some(s => v.startsWith(s));
  return isTested ? row.quantity_received : 0;
}

interface Props {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  limit?: number;
}

/**
 * Sidebar "Recent activity" rail for the Testing workspace.
 * Uses RecentActivityRailBase as a shell with Testing-specific logic.
 */
export function TestingRecentRail({
  selectedLineId,
  selectedRow = null,
  limit = 25,
}: Props) {
  // 'rail' segment keeps this DISTINCT from the main ReceivingLinesTable keys —
  // the table caches the full ApiResponse object under
  // ['receiving-lines-table', <view>, 'receive'|...], while the rail caches the
  // bare receiving_lines array. Sharing a key feeds one query the other's shape
  // (→ "allRows.slice is not a function"). Still under the
  // ['receiving-lines-table'] prefix so broad invalidations refresh it.
  const queryKey = useMemo(() => ['receiving-lines-table', 'rail', 'activity', 'test'] as const, []);

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    // For testing, we only care about items that have at least been received.
    // 'activity' drops untouched-incoming (EXPECTED, nothing received) so the
    // feed reflects what's been scanned/worked, not what's still en route.
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
      eyebrowSuffix="Testing Feed"
      getStatusDot={getTestingStatusDot}
      renderQuantity={(row) => {
        const tested = getTestedQty(row);
        const received = row.quantity_received;
        return (
          <span className={tested >= received && received > 0 ? 'text-emerald-600' : 'text-gray-600'}>
            {tested}/{received}
          </span>
        );
      }}
      previewQtyLabel="Tested"
      getPreviewQty={(row) => ({
        current: getTestedQty(row),
        total: row.quantity_received,
      })}
    />
  );
}
