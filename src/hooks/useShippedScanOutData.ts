'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { dashboardShippedQuery } from '@/lib/queries/dashboard-queries';
import { resolveShippedQueryArgs } from '@/lib/shipped-dashboard-params';
import { dedupeShippedRecords, deriveShippedRecord } from '@/lib/shipped-records';
import type { OutboundState } from '@/lib/outbound-state';
import type { PackerRecord } from '@/hooks/usePackerLogs';

export type OutboundCounts = Record<OutboundState, number>;

const ZERO_COUNTS: OutboundCounts = {
  PACKED_STAGED: 0,
  SCANNED_OUT: 0,
  IN_CUSTODY: 0,
  DELIVERED: 0,
  EXCEPTION: 0,
  PROCESS_GAP: 0,
  ORPHAN: 0,
};

/**
 * Week-summary counts for the scan-out sidebar tiles. Resolves params the same
 * way the main table does (so it shares one fetch via the React Query key) and
 * derives the outbound-state buckets from the deduped week records.
 */
export function useShippedScanOutData() {
  const searchParams = useSearchParams();
  const args = useMemo(() => resolveShippedQueryArgs(searchParams), [searchParams]);

  const query = useQuery({
    ...dashboardShippedQuery({
      weekStart: args.effectiveWeekStart,
      weekEnd: args.effectiveWeekEnd,
      packedBy: args.packedBy,
      testedBy: args.testedBy,
      shippedFilter: args.shippedFilter,
    }),
    placeholderData: (previousData) => previousData,
  });

  const counts = useMemo<OutboundCounts>(() => {
    const rows = (query.data ?? []) as PackerRecord[];
    if (rows.length === 0) return ZERO_COUNTS;
    const c: OutboundCounts = { ...ZERO_COUNTS };
    for (const r of dedupeShippedRecords(rows)) {
      c[deriveShippedRecord(r).outboundState] += 1;
    }
    return c;
  }, [query.data]);

  const total = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts],
  );

  return { counts, total, isFetching: query.isFetching };
}
