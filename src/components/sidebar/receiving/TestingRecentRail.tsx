'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/** 
 * Color logic for the left status dot in Testing view. 
 * Prioritizes testing flow states over receipt states.
 */
export function getTestingStatusDot(row: ReceivingLineRow): string {
  const v = String(row.workflow_status || '').trim().toUpperCase();
  
  // Terminal testing states
  if (v === 'PASSED' || v === 'DONE') return 'bg-emerald-500';
  if (v.startsWith('FAILED') || v === 'SCRAP' || v === 'RTV') return 'bg-rose-500';
  
  // Active testing states
  if (v === 'AWAITING_TEST' || v === 'IN_TEST') return 'bg-violet-500';
  
  // Preliminary states (received but not yet testing)
  if (v === 'MATCHED' || v === 'UNBOXED' || v === 'ARRIVED') return 'bg-blue-500';
  
  return 'bg-gray-400';
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
  // Use a separate query key for testing to avoid cache collisions with receiving 
  // if they use different views or params.
  const queryKey = useMemo(() => ['receiving-lines-table', 'all', 'test'] as const, []);

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    // For testing, we generally care about items that have at least been received.
    // 'all' still works best as a fallback to ensure we see the full chronological feed.
    params.set('view', 'all'); 
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
