'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/** Color logic for the left status dot in Receiving view. */
export function getReceivingStatusDot(row: ReceivingLineRow): string {
  const { workflow_status: status, quantity_received: qtyReceived, quantity_expected: qtyExpected } = row;
  
  if (
    qtyExpected != null &&
    qtyExpected > 0 &&
    qtyReceived != null &&
    qtyReceived >= qtyExpected
  ) {
    return 'bg-emerald-500';
  }
  const v = String(status || '').trim().toUpperCase();
  if (v === 'EXPECTED') return 'bg-amber-400';
  if (v === 'ARRIVED' || v === 'MATCHED') return 'bg-blue-500';
  if (v === 'UNBOXED') return 'bg-indigo-500';
  if (v === 'AWAITING_TEST' || v === 'IN_TEST') return 'bg-violet-500';
  if (v === 'PASSED' || v === 'DONE') return 'bg-emerald-500';
  if (v.startsWith('FAILED') || v === 'SCRAP' || v === 'RTV') return 'bg-rose-500';
  return 'bg-gray-400';
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
  const queryKey = useMemo(() => ['receiving-lines-table', 'all', 'receive'] as const, []);

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
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
      eyebrowSuffix="Same as History"
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
