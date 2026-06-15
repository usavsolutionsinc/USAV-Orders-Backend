'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { OUTBOUND_STATE_META, type OutboundState } from '@/lib/outbound-state';
import { useShippedScanOutData } from '@/hooks/useShippedScanOutData';
import { StatusLegend, type StatusLegendItem } from '@/components/ui/StatusLegend';

/**
 * Outbound (post-dock) status legend — the Shipped-mode subset of the shared
 * {@link StatusLegend}. One wrapped chip strip (dot + short label + count) that
 * reads cleanly in BOTH the Shipped List and Scan-Out modes and explains the
 * colored status dots in the table on the right.
 *
 * Counts come from {@link useShippedScanOutData}, which shares the main table's
 * React Query fetch — mounting this adds no extra request. EXCEPTION folds in
 * PROCESS_GAP (same bucket the scan-out tiles used).
 */
const ITEMS: StatusLegendItem<OutboundState>[] = [
  { state: 'PACKED_STAGED', short: 'Staging' },
  { state: 'SCANNED_OUT', short: 'Out' },
  { state: 'IN_CUSTODY', short: 'Custody' },
  { state: 'DELIVERED', short: 'Delivered' },
  { state: 'ORPHAN', short: 'Orphan' },
  { state: 'EXCEPTION', short: 'Exception', fold: 'PROCESS_GAP' },
];

export function OutboundStatusLegend() {
  const { counts, isFetching } = useShippedScanOutData();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Click-to-filter (`?ostatus`) — filters the shipped table to one derived
  // outbound state. Clicking the lit chip clears it.
  const activeStatus = (searchParams.get('ostatus') || '') as OutboundState | '';
  const toggleStatus = useCallback(
    (state: OutboundState) => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get('ostatus') === state) params.delete('ostatus');
      else params.set('ostatus', state);
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard', { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <StatusLegend
      items={ITEMS}
      meta={OUTBOUND_STATE_META}
      counts={counts}
      isFetching={isFetching}
      activeState={activeStatus || null}
      onSelectState={toggleStatus}
    />
  );
}
