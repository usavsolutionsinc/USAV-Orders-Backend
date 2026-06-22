'use client';

import { useQuery } from '@tanstack/react-query';
import type { IncomingSummary } from './incoming-summary-types';

/**
 * Polled aggregate counts for the status tiles. 30s cadence is the sweet spot:
 * fresh enough that a newly-delivered package surfaces between operator glances,
 * cheap enough that 100 concurrent operators each open one query connection.
 */
export function useIncomingSummary(): IncomingSummary | null {
  const { data: summaryData } = useQuery<{ success: true } & IncomingSummary>({
    queryKey: ['receiving-lines-incoming-summary'],
    queryFn: async () => {
      const res = await fetch('/api/receiving-lines/incoming/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error('summary fetch failed');
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return summaryData
    ? {
        issued: summaryData.issued,
        delivered_unopened: summaryData.delivered_unopened,
        delivered_email: summaryData.delivered_email ?? 0,
        arriving_today: summaryData.arriving_today,
        stalled: summaryData.stalled ?? 0,
        in_transit: summaryData.in_transit,
        pending_carrier: summaryData.pending_carrier ?? 0,
        carrier_mismatch: summaryData.carrier_mismatch ?? 0,
        tracking_unavailable: summaryData.tracking_unavailable ?? 0,
        awaiting_tracking: summaryData.awaiting_tracking,
        expected_today: summaryData.expected_today,
        by_carrier: summaryData.by_carrier,
      }
    : null;
}
