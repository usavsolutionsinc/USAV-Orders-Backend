'use client';

import type { QueryClient } from '@tanstack/react-query';

/**
 * Query-key roots for every receiving feed (Phase 1 of the receiving-triage
 * streamline — see docs/receiving-triage-streamline-plan.md §3.1).
 *
 * A single {@link invalidateReceivingFeeds} call refreshes all of them, so a
 * scan / receive mutation can never leave one rail stale because the wrong DOM
 * CustomEvent fired — the exact bug class that hid freshly-matched cartons from
 * the triage Prioritize tab (a matched scan only dispatched
 * `receiving-lines-prepended`, which the Prioritize rail did not listen to).
 *
 * `invalidateQueries` matches by key PREFIX, so each root covers every key
 * beneath it:
 *   ['receiving-lines-table']            → Prioritize rail, Recent/unbox rail, main table
 *   ['receiving']                        → triage Unfound list
 *   ['incoming-delivered-unscanned']     → delivered-but-not-scanned list
 *   ['receiving-lines-incoming-summary'] → Incoming tile counts
 *
 * New receiving feeds should key under one of these roots so this helper keeps
 * covering them with no extra wiring.
 */
export const RECEIVING_FEED_ROOTS: ReadonlyArray<ReadonlyArray<string>> = [
  ['receiving-lines-table'],
  ['receiving'],
  ['incoming-delivered-unscanned'],
  ['receiving-lines-incoming-summary'],
  // Incoming to-do list seeded from unmatched shipping-email order numbers —
  // refetches when an email rescan / Zoho refresh / scan changes the worklist.
  ['receiving-lines-incoming-todo'],
];

/**
 * Invalidate every receiving feed so all rails + tiles refetch atomically.
 * Call this from any mutation that changes receiving state (scan, match,
 * mark-received) instead of hand-picking a CustomEvent name.
 */
export function invalidateReceivingFeeds(queryClient: QueryClient): void {
  for (const queryKey of RECEIVING_FEED_ROOTS) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
