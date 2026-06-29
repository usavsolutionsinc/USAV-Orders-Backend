'use client';

/**
 * TanStack DB SPIKE — a normalized, live-query-backed receiving collection.
 *
 * This is the membership-aware version of "tier 1": instead of N rail React-Query
 * caches each holding a copy of rows (kept in sync by a hand-rolled event bus),
 * the rail's row-SET becomes a LIVE QUERY over one normalized collection. An
 * optimistic write to the collection updates every live query that selects it —
 * synchronously, no event dispatch, no refetch — and reconciles against the
 * server via the collection's queryFn.
 *
 * SCOPE: spike only. One collection (the `view=scanned` set) + one rail
 * (`ReceivingScannedRailDb`), rendered ONLY behind `?railEngine=db` so the live
 * sidebar is untouched. It uses its OWN QueryClient so it can't perturb the app
 * cache. Server write-back (onInsert/onUpdate/onDelete) is intentionally a no-op
 * here — the point is to feel the optimistic+live read path; the existing REST
 * mutations stay the source of truth and the queryFn refetch reconciles.
 *
 * If this feels right, the graduation path is: back the collection with the app
 * QueryClient, wire the on*-handlers to the real endpoints, and model each rail
 * (scanned / activity / viewed / unfound) as its own live query — membership
 * becomes a client-side `where`, which is exactly what the server views encode.
 */

import { QueryClient } from '@tanstack/react-query';
import { createCollection } from '@tanstack/react-db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';

// Isolated from the app's QueryClient — a spike must not perturb live caches.
const spikeQueryClient = new QueryClient();

/** The `view=scanned` set (door-scanned, not unboxed, matched) as a collection. */
export const receivingScannedCollection = createCollection(
  queryCollectionOptions<ReceivingLineRow>({
    queryKey: ['receiving-db-spike', 'scanned'],
    queryClient: spikeQueryClient,
    getKey: (row) => row.id,
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: '500',
        offset: '0',
        include: 'serials',
        view: 'scanned',
        sort: 'priority',
      });
      const res = await fetch(`/api/receiving-lines?${params.toString()}`);
      if (!res.ok) throw new Error('scanned fetch failed');
      const data = (await res.json()) as { receiving_lines?: ReceivingLineRow[] };
      // Same membership rule the real ReceivingScannedRail applies client-side.
      return (data.receiving_lines ?? []).filter((r) => r.receiving_source !== 'unmatched');
    },
    // Spike: optimistic-only. A real graduation wires these to the REST routes;
    // here we let the optimistic state stand and the next queryFn refetch reconcile.
    onInsert: async () => {},
    onUpdate: async () => {},
    onDelete: async () => {},
  }),
);

/**
 * Demo of the instant path: upsert a row into the collection. Every `useLiveQuery`
 * over it re-renders synchronously — no event dispatch, no refetch. Call this from
 * the pairing flow (when `?railEngine=db`) to watch the new line appear live.
 */
export function dbSpikeUpsertLine(row: ReceivingLineRow): void {
  const existing = receivingScannedCollection.get(row.id);
  if (existing) {
    receivingScannedCollection.update(row.id, (draft) => {
      Object.assign(draft as Record<string, unknown>, row);
    });
  } else {
    receivingScannedCollection.insert(row);
  }
}
