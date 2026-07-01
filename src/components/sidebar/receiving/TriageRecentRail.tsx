'use client';

/**
 * Triage "Prioritize" feed — cartons door-scanned and physically in but NOT yet
 * unboxed, priority-sorted (unfound/untagged first, then amazon → ebay →
 * goodwill). The to-do step BETWEEN the door scan and the unbox workspace.
 *
 * Thin binding over {@link ReceivingFeedRail} (feed `scanned`, `scope="triage"`).
 * Kept as a named seam so the triage Prioritize surface can diverge from the
 * unbox Queue later (e.g. a triage-specific intake status dot) without touching
 * the shared feed. The `scope` keeps it on its own cache entry, distinct from the
 * unbox Queue toggle.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { ReceivingFeedRail } from './ReceivingFeedRail';
import { useTriageStagingMap } from './useTriageStagingMap';
import { TriageStagingChips } from './TriageStagingChips';

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
  const stagingMap = useTriageStagingMap();
  return (
    <ReceivingFeedRail
      feed="scanned"
      scope="triage"
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      filterText={filterText}
      renderPopoverContext={(row) => (
        <TriageStagingChips
          ctx={row.receiving_id != null ? stagingMap.get(row.receiving_id) : undefined}
        />
      )}
    />
  );
}
