'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReceivingModeDescriptor } from '@/lib/receiving/receiving-modes';
import type { ApiResponse } from '@/components/station/receiving-lines-table-helpers';
import {
  type DeliveredUnscannedResponse,
} from '@/components/station/receiving-delivered-unscanned';
import { useReceivingModeContext } from '@/components/station/useReceivingModeContext';

/**
 * Filtered Incoming backlog total — the same `total` the right-pane table and
 * pagination read from `/api/receiving-lines?view=incoming`. Shares the table's
 * react-query cache (page-1 key) so the sidebar pill and header never drift from
 * `summary.issued` (distinct POs) or from each other.
 */
export function useIncomingTableTotal(): number | undefined {
  const { modeContext, isIncomingMode, isDeliveredUnscannedFacet } = useReceivingModeContext();
  const incomingMode = getReceivingModeDescriptor('incoming');

  const countContext = useMemo(
    () => ({ ...modeContext, incomingPage: 1 }),
    [modeContext],
  );
  const queryKey = incomingMode.queryKey(countContext);

  const { data: listData } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines?${incomingMode.buildParams(countContext).toString()}`,
      );
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    },
    enabled: isIncomingMode && !isDeliveredUnscannedFacet,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });

  const { data: deliveredData } = useQuery<DeliveredUnscannedResponse>({
    queryKey: ['incoming-delivered-unscanned'],
    queryFn: async () => {
      const res = await fetch('/api/receiving-lines/incoming/delivered-unscanned', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('delivered-unscanned fetch failed');
      return res.json();
    },
    enabled: isIncomingMode && isDeliveredUnscannedFacet,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!isIncomingMode) return undefined;
  if (isDeliveredUnscannedFacet) {
    return deliveredData?.items?.length;
  }
  return listData?.total;
}
