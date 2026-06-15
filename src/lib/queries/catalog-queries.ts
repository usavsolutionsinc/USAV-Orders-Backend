import { queryOptions } from '@tanstack/react-query';
import type { PlatformRow, PlatformAccountRow, TypeRow } from '@/lib/neon/catalog-queries';

/** One bindable workflow-graph node (from /api/catalog/workflow-nodes). */
export interface WorkflowNodeOption {
  id: string;
  type: string;
  label: string;
  definitionId: number;
  definitionName: string | null;
}

/**
 * React Query factory for the org platform / type catalog. Keys + queryOptions
 * live here (the house pattern, see cron-runs-queries.ts); the `useCatalog`
 * hooks wrap these and layer the built-in fallback.
 */

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const catalogKeys = {
  all: ['catalog'] as const,
  platforms: (includeInactive = false) => ['catalog', 'platforms', includeInactive] as const,
  types: (includeInactive = false) => ['catalog', 'types', includeInactive] as const,
  accounts: (includeInactive = false, platformId?: number) =>
    ['catalog', 'platform-accounts', includeInactive, platformId ?? null] as const,
  workflowNodes: () => ['catalog', 'workflow-nodes'] as const,
};

export function platformsQuery(opts: { includeInactive?: boolean } = {}) {
  const inc = opts.includeInactive ?? false;
  return queryOptions({
    queryKey: catalogKeys.platforms(inc),
    queryFn: () =>
      fetchJson<{ success: boolean; platforms: PlatformRow[] }>(
        `/api/catalog/platforms${inc ? '?includeInactive=true' : ''}`,
      ),
    staleTime: 5 * 60_000,
    select: (d) => d.platforms ?? [],
  });
}

export function typesQuery(opts: { includeInactive?: boolean } = {}) {
  const inc = opts.includeInactive ?? false;
  return queryOptions({
    queryKey: catalogKeys.types(inc),
    queryFn: () =>
      fetchJson<{ success: boolean; types: TypeRow[] }>(
        `/api/catalog/types${inc ? '?includeInactive=true' : ''}`,
      ),
    staleTime: 5 * 60_000,
    select: (d) => d.types ?? [],
  });
}

export function platformAccountsQuery(opts: { includeInactive?: boolean; platformId?: number } = {}) {
  const inc = opts.includeInactive ?? false;
  const params = new URLSearchParams();
  if (inc) params.set('includeInactive', 'true');
  if (opts.platformId) params.set('platformId', String(opts.platformId));
  const qs = params.toString();
  return queryOptions({
    queryKey: catalogKeys.accounts(inc, opts.platformId),
    queryFn: () =>
      fetchJson<{ success: boolean; accounts: PlatformAccountRow[] }>(
        `/api/catalog/platform-accounts${qs ? `?${qs}` : ''}`,
      ),
    staleTime: 5 * 60_000,
    select: (d) => d.accounts ?? [],
  });
}

export function workflowNodesQuery() {
  return queryOptions({
    queryKey: catalogKeys.workflowNodes(),
    queryFn: () => fetchJson<{ success: boolean; nodes: WorkflowNodeOption[] }>('/api/catalog/workflow-nodes'),
    staleTime: 5 * 60_000,
    select: (d) => d.nodes ?? [],
  });
}
