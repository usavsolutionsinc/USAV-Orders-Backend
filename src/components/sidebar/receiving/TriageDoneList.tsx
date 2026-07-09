'use client';

/**
 * Triage "Done" list — cartons already staged + saved for unbox
 * (`receiving.triage_complete = true`, §3.1/E10). Answers E10 without removing
 * cartons from the triage universe: a carton that's Done still shows on the
 * combined Triage tab too (with a "Staged" badge — see `useTriageStagedCartons`),
 * this tab is just a filtered view for "what did I already stage today".
 *
 * Pure composition, thin binding over {@link ReceivingFeedRail} (feed `triageDone`)
 * — mirrors TriageUnfoundList/TriageCombinedList.
 */

import { ReceivingFeedRail } from './ReceivingFeedRail';
import { useTriageStagingMap } from './useTriageStagingMap';
import { TriageStagingChips } from './TriageStagingChips';

export function TriageDoneList({
  selectedLineId,
  filterText = '',
}: {
  selectedLineId: number | null;
  filterText?: string;
}) {
  const stagingMap = useTriageStagingMap();
  return (
    <ReceivingFeedRail
      feed="triageDone"
      selectedLineId={selectedLineId}
      filterText={filterText}
      renderPopoverContext={(row) => (
        <TriageStagingChips
          ctx={row.receiving_id != null ? stagingMap.get(row.receiving_id) : undefined}
        />
      )}
    />
  );
}
