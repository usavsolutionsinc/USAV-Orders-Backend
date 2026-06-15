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
