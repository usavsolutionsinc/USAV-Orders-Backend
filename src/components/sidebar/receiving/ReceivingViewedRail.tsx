'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { getReceivingStatusDot, getReceivingStatusDotLabel } from './ReceivingRecentRail';

interface Props {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  limit?: number;
}

/**
 * Time label for the "Viewed" rail = when YOU opened each line. The server folds
 * the viewer's own `viewed_at` into `last_activity_at` for view=viewed, so the
 * rail reads "you opened this 3m ago" rather than the unrelated scan/line time.
 */
function getViewedAt(r: ReceivingLineRow): string | null {
  return r.last_activity_at ?? r.updated_at ?? r.created_at ?? null;
}

/**
 * Sidebar "Viewed" rail — the receiving lines THIS operator recently opened in
 * the workspace, newest-opened first. Backed by `view=viewed`
 * (receiving_line_views, per-staff). Reuses RecentActivityRailBase + the shared
 * receiving status-dot logic so it reads identically to the Unboxed rail.
 */
export function ReceivingViewedRail({
  selectedLineId,
  selectedRow = null,
  limit = 25,
}: Props) {
  // Distinct cache segment from the Unboxed ('activity') rail so the two feeds
  // never share a query entry; still under the broad ['receiving-lines-table']
  // prefix so global invalidations refresh it.
  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', 'viewed', 'receive'] as const,
    [],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    params.set('view', 'viewed');
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
      deleteEvent="receiving-line-deleted"
      deleteGroupEvent="receiving-entry-deleted"
      refreshEvents={['receiving-entry-added', 'receiving-entry-deleted', 'usav-refresh-data']}
      eyebrowTitle="Viewed"
      autoSelectFirstWhenEmpty
      getActivityAt={getViewedAt}
      getStatusDot={getReceivingStatusDot}
      getStatusDotLabel={getReceivingStatusDotLabel}
      renderQuantity={(row) => (
        <span
          className={
            row.quantity_expected != null && row.quantity_received >= row.quantity_expected
              ? 'text-emerald-600'
              : 'text-gray-600'
          }
        >
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
