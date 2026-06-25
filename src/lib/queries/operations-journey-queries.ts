import { queryOptions } from '@tanstack/react-query';
import type { JourneyUrlFilters } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import type { JourneyEvent, JourneyDimension } from '@/lib/timeline/journey';

/**
 * Query factory + key builders for the Master Operations Journey endpoint.
 * Focused mode (a specific order/serial/tracking) uses a plain query; browse mode
 * uses `useInfiniteQuery` with the keyset `cursor` (wired in `useOperationsJourney`).
 */

export interface JourneyEntitySummary {
  kind: JourneyDimension;
  orderId: number | null;
  orderNumber: string | null;
  shipmentId: number | null;
  serialUnitIds: number[];
  serials: string[];
  trackingNumbers: string[];
}

export interface JourneyResponse {
  success: boolean;
  mode: 'entity' | 'browse';
  entity: JourneyEntitySummary | null;
  events: JourneyEvent[];
  nextCursor: string | null;
  limit: number;
}

function entityValueFor(f: JourneyUrlFilters): string {
  return f.dim === 'order' ? f.order ?? '' : f.dim === 'serial' ? f.serial ?? '' : f.tracking ?? '';
}

function appendFilters(p: URLSearchParams, f: JourneyUrlFilters): void {
  if (f.from) p.set('from', f.from);
  if (f.until) p.set('until', f.until);
  if (f.stations.length) p.set('stations', f.stations.join(','));
  if (f.types.length) p.set('types', f.types.join(','));
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
}

export function buildFocusedQueryString(f: JourneyUrlFilters): string {
  const p = new URLSearchParams();
  p.set('dim', f.dim);
  const entity = entityValueFor(f).trim();
  if (entity) p.set(f.dim, entity);
  appendFilters(p, f);
  return p.toString();
}

export function buildBrowseQueryString(f: JourneyUrlFilters, cursor: string | null): string {
  const p = new URLSearchParams();
  p.set('dim', f.dim);
  appendFilters(p, f);
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

export const journeyKeys = {
  all: ['ops-journey'] as const,
  focused: (f: JourneyUrlFilters) => ['ops-journey', 'focused', buildFocusedQueryString(f)] as const,
  browse: (f: JourneyUrlFilters) => ['ops-journey', 'browse', buildBrowseQueryString(f, null)] as const,
};

async function fetchJourney(qs: string): Promise<JourneyResponse> {
  const res = await fetch(`/api/operations/journey?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load the operations journey');
  return (await res.json()) as JourneyResponse;
}

/** Focused (single-entity) journey — a plain query, no pagination. */
export function operationsJourneyFocusedQuery(f: JourneyUrlFilters) {
  return queryOptions({
    queryKey: journeyKeys.focused(f),
    queryFn: () => fetchJourney(buildFocusedQueryString(f)),
    staleTime: 10_000,
  });
}

/** Browse infinite-query config (spread into `useInfiniteQuery`). */
export function operationsJourneyBrowseQueryConfig(f: JourneyUrlFilters) {
  return {
    queryKey: journeyKeys.browse(f),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      fetchJourney(buildBrowseQueryString(f, pageParam)),
    getNextPageParam: (last: JourneyResponse) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  };
}
