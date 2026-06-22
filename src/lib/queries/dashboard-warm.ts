import type { QueryClient } from '@tanstack/react-query';
import { getDashboardOrderViewFromSearch } from '@/utils/dashboard-search-state';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { readShippedFilterPreference } from '@/utils/dashboard-preferences';
import {
  unshippedOrdersQuery,
  dashboardShippedQuery,
  fbaShipmentsQuery,
  warrantyClaimsQuery,
} from '@/lib/queries/dashboard-queries';
import { WARRANTY_EXPIRING_SOON_DAYS } from '@/hooks/useWarrantyClaims';
import { isWarrantyClaimStatus } from '@/lib/warranty/types';

/**
 * Warm the active dashboard view's data into the React Query cache. Shared by
 * the page-level warm-up effect and the sign-in BootGate so a prefetch and the
 * table that later mounts always hit the same cache key (the factories are the
 * single source of truth). `shippedFilter` falls back to the stored preference,
 * matching how `DashboardShippedTable` resolves it. Returns a promise that
 * settles when the active view is ready.
 */
export function warmActiveView(
  queryClient: QueryClient,
  searchParamsString: string,
): Promise<unknown> {
  const sp = new URLSearchParams(searchParamsString);
  const view = getDashboardOrderViewFromSearch(sp);
  const searchQuery = String(sp.get('search') || '').trim();

  if (view === 'unshipped') {
    return queryClient.prefetchQuery(unshippedOrdersQuery({ searchQuery, strictSearchScope: true }));
  }
  if (view === 'fba') {
    return queryClient.prefetchQuery(fbaShipmentsQuery());
  }
  if (view === 'warranty') {
    const wstatus = sp.get('wstatus');
    return queryClient.prefetchQuery(
      warrantyClaimsQuery({
        status: isWarrantyClaimStatus(wstatus) ? wstatus : null,
        search: searchQuery,
        expiringWithinDays: sp.get('wexp') === '1' ? WARRANTY_EXPIRING_SOON_DAYS : null,
      }),
    );
  }
  if (view === 'shipped') {
    const week = getWeekRangeForOffset(0);
    const shippedFilter = sp.get('shippedFilter') || readShippedFilterPreference() || 'all';
    return queryClient.prefetchQuery(
      dashboardShippedQuery({ weekStart: week.startStr, weekEnd: week.endStr, shippedFilter }),
    );
  }
  // Default + legacy `?pending` → the merged Unshipped backlog.
  return queryClient.prefetchQuery(unshippedOrdersQuery({ searchQuery, strictSearchScope: true }));
}
