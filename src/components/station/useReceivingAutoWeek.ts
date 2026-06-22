'use client';

/**
 * History auto-week jump: the History tab defaults to the current PST week, but
 * a fresh week (Sunday morning, or before that week's first scan) is empty while
 * last week is full — so it rendered its empty state with plenty of rows one
 * week back. When the current week is empty but earlier weeks have data, jump
 * the window back to the most recent week with activity. One-shot per mount, so
 * manually paging forward to an empty current week isn't bounced back. Extracted
 * from ReceivingLinesTable; behaviour is unchanged.
 */

import { useEffect, useRef } from 'react';
import type { WeekRange } from '@/utils/date';
import type { ReceivingPoGroup } from '@/components/station/receiving-lines-table-helpers';

interface UseReceivingAutoWeekArgs {
  isHistoryMode: boolean;
  skipWeekFilter: boolean;
  weekOffset: number;
  setWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  filteredGroupedRecords: Record<string, ReceivingPoGroup[]>;
  groupedRecords: Record<string, ReceivingPoGroup[]>;
  weekRange: WeekRange;
}

export function useReceivingAutoWeek({
  isHistoryMode,
  skipWeekFilter,
  weekOffset,
  setWeekOffset,
  filteredGroupedRecords,
  groupedRecords,
  weekRange,
}: UseReceivingAutoWeekArgs): void {
  const autoWeekAppliedRef = useRef(false);

  useEffect(() => {
    if (!isHistoryMode || skipWeekFilter) return;
    if (autoWeekAppliedRef.current || weekOffset !== 0) return;
    // Current week already has rows → nothing to do; lock the one-shot.
    if (Object.keys(filteredGroupedRecords).length > 0) {
      autoWeekAppliedRef.current = true;
      return;
    }
    const latest = Object.keys(groupedRecords)
      .filter((d) => d !== 'Unknown')
      .sort((a, b) => b.localeCompare(a))[0];
    if (!latest) return; // still loading or genuinely empty — keep waiting.
    autoWeekAppliedRef.current = true;
    const curSunday = new Date(`${weekRange.startStr}T00:00:00`);
    const latestDate = new Date(`${latest}T00:00:00`);
    const diffDays = Math.round(
      (curSunday.getTime() - latestDate.getTime()) / 86_400_000,
    );
    if (diffDays > 0) setWeekOffset(Math.ceil(diffDays / 7));
  }, [
    isHistoryMode,
    skipWeekFilter,
    weekOffset,
    filteredGroupedRecords,
    groupedRecords,
    weekRange.startStr,
    setWeekOffset,
  ]);
}
