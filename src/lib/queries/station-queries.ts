/**
 * Query factory for station-builder definitions + block data sources.
 *
 * Definitions change rarely (publish events), so a long staleTime with
 * explicit invalidation after save/publish. Source feeds reuse whatever
 * cadence their block needs — but never an interval (sidebar surfaces poll
 * via their own existing summaries; block feeds refetch on mount/invalidate).
 */

import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { StationDefinitionRow } from '@/lib/stations/contract';

export interface StationDefinitionsResp {
  success: boolean;
  definitions: StationDefinitionRow[];
  drafts: StationDefinitionRow[];
  canManage: boolean;
}

export const stationKeys = {
  all: ['stations'] as const,
  page: (pageKey: string) => ['stations', 'page', pageKey] as const,
  source: (sourceId: string, filters: Record<string, unknown>) =>
    ['stations', 'source', sourceId, filters] as const,
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json as T;
}

export function stationDefinitionsQuery(pageKey: string) {
  return queryOptions({
    queryKey: stationKeys.page(pageKey),
    queryFn: () => fetchJson<StationDefinitionsResp>(`/api/stations?page=${encodeURIComponent(pageKey)}`),
    staleTime: 5 * 60_000,
  });
}

export function stationSourceQuery(sourceId: string, url: string, filters: Record<string, unknown>) {
  return queryOptions({
    queryKey: stationKeys.source(sourceId, filters),
    queryFn: () => fetchJson<unknown>(url),
    // Worklist feeds move on human actions, not continuously — actions
    // invalidate explicitly after each mutation, so ambient refetch can be lazy.
    staleTime: 2 * 60_000,
  });
}

export function invalidateStationDefinitions(queryClient: QueryClient, pageKey?: string): void {
  void queryClient.invalidateQueries({
    queryKey: pageKey ? stationKeys.page(pageKey) : stationKeys.all,
  });
}

export function invalidateStationSource(queryClient: QueryClient, sourceId: string): void {
  void queryClient.invalidateQueries({
    queryKey: ['stations', 'source', sourceId],
  });
}
