import type { QueryClient } from '@tanstack/react-query';

/** Dashboard + packer caches touched by dock scan-out / undo. */
export const SCAN_OUT_INVALIDATION_KEYS = [
  ['dashboard-table', 'shipped'],
  ['dashboard-table', 'unshipped'],
  ['dashboard-table', 'pending'],
  ['packer-logs'],
] as const;

/** Outbound station query namespaces. */
export const OUTBOUND_QUERY_PREFIXES = [
  ['outbound', 'labels'],
  ['outbound', 'staged'],
] as const;

export function bustScanOutCaches(queryClient: QueryClient) {
  for (const queryKey of SCAN_OUT_INVALIDATION_KEYS) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
  for (const queryKey of OUTBOUND_QUERY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** Invalidate Outbound · Labels caches after tracking/label writes. */
export function bustLabelsCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['outbound', 'labels'] });
  queryClient.invalidateQueries({ queryKey: ['outbound-search', 'labels-count'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
}

/** Invalidate fulfillment + outbound queues after assignment changes. */
export function bustFulfillmentCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
  queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
  for (const queryKey of OUTBOUND_QUERY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}
