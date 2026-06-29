'use client';

/**
 * Triage recent/door rail — the triage sidebar's "Prioritize" feed: cartons
 * door-scanned and physically in but NOT yet unboxed, priority-sorted
 * (unfound/untagged first, then amazon → ebay → goodwill). This is the to-do
 * step BETWEEN the door scan and the unbox workspace.
 *
 * Composition, not a fork: it wraps {@link ReceivingScannedRail} scoped to
 * `triage`, which itself is a thin {@link RecentActivityRailBase} wrapper
 * (supplying only renderers — selection highlight, hover preview, status dot).
 * Pulling the triage feed behind its own named component gives the triage
 * surface a stable seam to diverge from the unbox Queue later (e.g. a
 * triage-specific intake status dot) without touching the shared scanned rail.
 *
 * Lower-risk data choice (documented): the rail is driven by the EXISTING
 * `view=scanned` query — no new server view was added to the (hot, 2k-line)
 * `/api/receiving-lines` route, since `scanned` already returns exactly this
 * door feed. Unmatched cartons are excluded here (they live in the parallel
 * Unfound list) so the two triage tabs never double-list the same carton.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { ReceivingScannedRail } from './ReceivingScannedRail';

export function TriageRecentRail({
  selectedLineId,
  selectedRow = null,
  filterText = '',
}: {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  /** Desktop search text from the sidebar SearchBar (filters the list). */
  filterText?: string;
}) {
  return (
    <ReceivingScannedRail
      scope="triage"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      filterText={filterText}
    />
  );
}
