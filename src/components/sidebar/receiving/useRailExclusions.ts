'use client';

/**
 * The signed-in staffer's rail-dismiss set for a feed (universal-feed plan
 * Phase 4 read filter). Fetches GET /api/receiving/rail-exclusions?feedKey= and
 * returns the excluded rows as a Set of RAIL IDS (row.id space) so a rail
 * fetcher can drop them with `rows.filter(r => !set.has(r.id))`.
 *
 * A dismissed row is hidden for THIS staffer only; the row still exists. The
 * write path (useRailEditMode) invalidates ['rail-exclusions', feedKey] after a
 * dismiss so the filter picks it up before the next rail refetch un-hides it.
 */

import { useQuery } from '@tanstack/react-query';
import { exclusionToRailId } from '@/lib/receiving/rail/exclusion-feed-key';

interface ExclusionItem {
  entityType: string;
  entityId: number;
}

const EMPTY: ReadonlySet<number> = new Set();

export function useRailExclusions(feedKey: string | null): ReadonlySet<number> {
  const { data } = useQuery<ReadonlySet<number>>({
    queryKey: ['rail-exclusions', feedKey],
    enabled: !!feedKey,
    staleTime: 15_000,
    queryFn: async () => {
      const res = await fetch(`/api/receiving/rail-exclusions?feedKey=${encodeURIComponent(feedKey!)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return EMPTY;
      const body = (await res.json().catch(() => null)) as { items?: ExclusionItem[] } | null;
      const items = body?.items ?? [];
      return new Set(items.map((it) => exclusionToRailId(it.entityType, it.entityId)));
    },
  });
  return data ?? EMPTY;
}
