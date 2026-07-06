import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { JourneyUrlFilters } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import type { JourneyEvent, JourneyDimension } from '@/lib/timeline/journey';

/**
 * Query factory + key builders for the Master Operations Journey endpoint.
 * Focused mode (a specific order/serial/tracking) uses a plain query; browse mode
 * uses `useInfiniteQuery` with the keyset `cursor` (wired in `useOperationsJourney`).
 */

/**
 * Per-serial provenance for the By-unit band headers (SKU · grade · status ·
 * originating PO). Client mirror of `SerialProvenance` in
 * `@/lib/operations/journey-helpers` — kept structurally local so this client
 * module never imports the server-side journey domain.
 */
export interface SerialProvenance {
  serialUnitId: number;
  serial: string;
  sku: string | null;
  grade: string | null;
  status: string | null;
  poNumber: string | null;
}

export interface JourneyEntitySummary {
  kind: JourneyDimension;
  orderId: number | null;
  orderNumber: string | null;
  shipmentId: number | null;
  serialUnitIds: number[];
  serials: string[];
  trackingNumbers: string[];
  /** Per-serial provenance for the By-unit band headers (may be absent on older payloads). */
  serialProvenance?: SerialProvenance[];
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
  if (f.staffId) p.set('staffId', f.staffId);
  if (f.sources.length) p.set('sources', f.sources.join(','));
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

/**
 * Browse query string — the same narrowing filters as focused, but with NO
 * entity value (that's what makes the route serve `mode:'browse'`), plus the
 * opaque keyset `cursor` for the next page. `q` rides along so a browse can be
 * text-narrowed once the unified header search populates it.
 */
export function buildBrowseQueryString(f: JourneyUrlFilters, cursor: string | null): string {
  const p = new URLSearchParams();
  appendFilters(p, f);
  if (cursor) p.set('cursor', cursor);
  return p.toString();
}

export const journeyKeys = {
  all: ['ops-journey'] as const,
  focused: (f: JourneyUrlFilters) => ['ops-journey', 'focused', buildFocusedQueryString(f)] as const,
  // Page-param (cursor) is intentionally excluded from the key: it's the
  // useInfiniteQuery pageParam, not part of the cache identity.
  browse: (f: JourneyUrlFilters) => ['ops-journey', 'browse', buildBrowseQueryString(f, null)] as const,
};

async function fetchJourney(qs: string): Promise<JourneyResponse> {
  const res = await fetch(`/api/operations/journey?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load the operations journey');
  return (await res.json()) as JourneyResponse;
}

/** Focused record lookup — a plain query, no browse/pagination. */
export function operationsJourneyFocusedQuery(f: JourneyUrlFilters) {
  return queryOptions({
    queryKey: journeyKeys.focused(f),
    queryFn: () => fetchJourney(buildFocusedQueryString(f)),
    staleTime: 10_000,
  });
}

/**
 * Browse feed — keyset-paginated `useInfiniteQuery`. `pageParam` is the opaque
 * cursor string (null for the first page); the next page param is the response's
 * `nextCursor` (undefined = no more pages). Monitor archetype: refetch-on-focus
 * keeps it fresh; no realtime patching.
 */
export function operationsJourneyBrowseInfiniteQuery(f: JourneyUrlFilters) {
  return infiniteQueryOptions({
    queryKey: journeyKeys.browse(f),
    queryFn: ({ pageParam }) => fetchJourney(buildBrowseQueryString(f, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last: JourneyResponse) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}
