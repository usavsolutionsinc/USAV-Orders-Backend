'use client';

/**
 * Triage "Triage" list — the combined working feed: Prioritize ∪ Unfound in ONE
 * list, newest-scanned first. This is the default triage view.
 *
 * Why combined: a carton must not jump out of the operator's list the instant
 * its PO is linked. The "Prioritize" tab (matched, priority-sorted) and the
 * "Unfound" tab (unmatched, no PO) are filtered SUBSETS of this list — linking a
 * PO moves a carton between those subsets, but on the Triage tab it simply stays
 * put (re-sorted by recency), so the operator keeps working what they just
 * scanned in without it disappearing.
 *
 * Composition, not a fork: the union (and its degrade-not-fail merge) lives in
 * `buildTriageCombinedFetcher` (`@/lib/receiving/rail/feeds`), which reuses the
 * EXACT same two subset fetchers the sub-tab rails use (so Triage = their union,
 * never a divergent third query). This component is a thin binding over
 * {@link ReceivingFeedRail}.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { ReceivingFeedRail } from './ReceivingFeedRail';

export function TriageCombinedList({
  selectedLineId,
  selectedRow = null,
  leadingRow = null,
  isRowDisabled,
  filterText = '',
}: {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  /** Optimistic "importing" stub pinned at the top until its real row lands. */
  leadingRow?: ReceivingLineRow | null;
  /** Suppress clicks on in-flight importing rows so the right pane stays usable. */
  isRowDisabled?: (row: ReceivingLineRow) => boolean;
  filterText?: string;
}) {
  return (
    <ReceivingFeedRail
      feed="triageCombined"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      leadingRow={leadingRow}
      getRowDisabled={isRowDisabled}
      filterText={filterText}
    />
  );
}
