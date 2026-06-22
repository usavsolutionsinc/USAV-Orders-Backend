'use client';

/**
 * Prefetch-warm the dashboard's data into the React Query cache.
 *
 * Warms the active view immediately (same factories as the BootGate + tables →
 * guaranteed cache hit) and, after a short idle delay, the merged Unshipped
 * backlog so switching back to it feels instant. Extracted from the dashboard
 * page; behaviour is unchanged.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { warmActiveView } from '@/lib/queries/dashboard-warm';
import { unshippedOrdersQuery } from '@/lib/queries/dashboard-queries';
import type { DashboardOrderView } from '@/utils/dashboard-search-state';

interface UseDashboardViewWarmupArgs {
  orderView: DashboardOrderView;
  /** Included so a search change re-warms the active view (matches prior deps). */
  searchQuery: string;
}

export function useDashboardViewWarmup({
  orderView,
  searchQuery,
}: UseDashboardViewWarmupArgs): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch the active view immediately so it loads as fast as possible.
    void warmActiveView(queryClient, window.location.search);

    // Warm the merged Unshipped backlog after a short idle delay so landing on
    // another tab and switching back feels instant. strictSearchScope mirrors
    // how the dashboard mounts the table.
    const timer = setTimeout(() => {
      if (orderView !== 'unshipped') {
        void queryClient.prefetchQuery(unshippedOrdersQuery({ strictSearchScope: true }));
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [queryClient, orderView, searchQuery]);
}
