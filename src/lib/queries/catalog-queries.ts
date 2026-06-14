import { queryOptions } from '@tanstack/react-query';
import type { PlatformRow, TypeRow } from '@/lib/neon/catalog-queries';

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
