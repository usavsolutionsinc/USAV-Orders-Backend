import type { QueryClient } from '@tanstack/react-query';

/**
 * Single client-side refresh path after order imports or other multi-tab order writes.
 * Invalidates all dashboard order list queries so each table refetches a full snapshot from the API.
 */
export async function invalidateDashboardOrderQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped-fba'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['shipped-table'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-stock-zoho'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['dashboard-fba-shipments'], refetchType: 'active' }),
  ]);
}

/** One global signal for components that are not on React Query yet. */
export function dispatchUsavRefreshData() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
}
