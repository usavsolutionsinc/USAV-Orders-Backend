'use client';

/**
 * The scanned-but-not-unboxed "Prioritize" queue, fetched once and shared.
 *
 * Mirrors ReceivingScannedRail's fetch exactly (`view=scanned&sort=priority`,
 * unmatched dropped — unfound cartons live in the separate triage tab) so the
 * right-pane priority display lines up 1:1 with the rail the operator sees, and
 * so React Query dedupes the two reads instead of hitting Neon twice.
 */

import { useQuery } from '@tanstack/react-query';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  receiving_lines?: ReceivingLineRow[];
}

export const SCANNED_PRIORITY_QUEUE_KEY = ['receiving-priority-queue', 'scanned'] as const;

export function useScannedPriorityQueue() {
  return useQuery<ReceivingLineRow[]>({
    queryKey: SCANNED_PRIORITY_QUEUE_KEY,
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: '500',
        offset: '0',
        view: 'scanned',
        sort: 'priority',
      });
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('fetch failed');
      const data = (await res.json()) as ApiResponse;
      // Match the rail: unmatched/unfound cartons are surfaced in the Unfound
      // tab, not the Prioritize rail, so they don't count toward this queue.
      return (data.receiving_lines ?? []).filter((r) => r.receiving_source !== 'unmatched');
    },
    staleTime: 30_000,
  });
}
