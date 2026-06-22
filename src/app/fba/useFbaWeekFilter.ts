'use client';

/**
 * Week pagination + per-mode scoping for the FBA board. Bands the pending list
 * to the visible Mon–Sun week, then narrows by mode (plan→PLANNED,
 * combine→PACKED). Extracted from fba/page; behaviour is unchanged.
 */

import { useMemo, useState } from 'react';
import { getCurrentPSTDateKey } from '@/utils/date';
import type { FbaBoardItem } from '@/components/fba/FbaBoardTable';
import type { FbaMode } from '@/lib/fba/fba-modes';
import { getWeekRange, isItemInWeek } from './fba-page-helpers';

export interface FbaWeekFilter {
  weekRange: { startStr: string; endStr: string };
  weekOffset: number;
  setWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  filteredPendingItems: FbaBoardItem[];
  boardEmptyMessage: string;
}

export function useFbaWeekFilter(pending: FbaBoardItem[], activeMode: FbaMode): FbaWeekFilter {
  const todayKey = getCurrentPSTDateKey();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekRange = useMemo(() => getWeekRange(todayKey, weekOffset), [todayKey, weekOffset]);

  const combineItemsForWeek = useMemo(
    () => pending.filter((i) => isItemInWeek(i, weekRange.startStr, weekRange.endStr)),
    [pending, weekRange],
  );

  // Each mode scopes the board to its worklist:
  //   plan    → PLANNED  (still being planned)
  //   combine → PACKED   (packed and ready to combine under one FBA shipment ID)
  const filteredPendingItems = useMemo(() => {
    if (activeMode === 'plan') return combineItemsForWeek.filter((i) => i.item_status === 'PLANNED');
    if (activeMode === 'combine') return combineItemsForWeek.filter((i) => i.item_status === 'PACKED');
    return combineItemsForWeek;
  }, [combineItemsForWeek, activeMode]);

  const boardEmptyMessage =
    activeMode === 'plan' ? 'No items in planning' : 'No packed items to combine';

  return { weekRange, weekOffset, setWeekOffset, filteredPendingItems, boardEmptyMessage };
}
