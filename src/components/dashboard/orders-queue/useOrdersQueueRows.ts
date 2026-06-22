'use client';

import { useMemo } from 'react';
import { toPSTDateKey } from '@/utils/date';
import { groupRowsBy, type RowGroup } from '@/lib/group-rows';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import {
  isShippedByLatestStatus,
  type OrdersQueueMode,
  type OrdersQueueSort,
  type QueueRowRecord,
} from './helpers';

export interface OrdersQueueRows {
  /** Records still in the queue (already-shipped rows filtered out). */
  visibleRecords: ShippedOrder[];
  /** Date bands → folded order groups, in canonical render order. */
  orderGroupsByDate: [string, RowGroup<ShippedOrder>[]][];
  /** Flat list matching the on-screen order (keyboard nav, shift-range select). */
  displayedRecords: ShippedOrder[];
  /** Count of dated, visible records. */
  totalCount: number;
}

export interface UseOrdersQueueRowsOptions {
  records: ShippedOrder[];
  sort: OrdersQueueSort;
  queueMode: OrdersQueueMode;
}

/**
 * Derives the date-banded, order-grouped view of the queue from the raw
 * records. Filters already-shipped rows, bands by deadline/created date, sorts
 * within each day, then folds lines that share an order number into one group.
 *
 * The flat `displayedRecords` is flattened from the SAME grouped order so that
 * keyboard-nav and shift-range select line up with exactly what's on screen.
 */
export function useOrdersQueueRows({
  records,
  sort,
  queueMode,
}: UseOrdersQueueRowsOptions): OrdersQueueRows {
  return useMemo(() => {
    const visibleRecords = records.filter((record) => !isShippedByLatestStatus(record));

    const groupedRecords: Record<string, ShippedOrder[]> = {};
    visibleRecords.forEach((record) => {
      // `newest` bands by when the order was added; otherwise by its deadline.
      const dateSource = sort === 'newest'
        ? (record.created_at || record.deadline_at)
        : (record.deadline_at || record.created_at);
      if (!dateSource || dateSource === '1') return;

      let date = '';
      try {
        date = toPSTDateKey(String(dateSource)) || 'Unknown';
      } catch {
        date = 'Unknown';
      }

      if (!groupedRecords[date]) groupedRecords[date] = [];
      groupedRecords[date].push(record);
    });

    // One canonical per-day ordering, shared by the rendered rows AND the flat
    // `displayedRecords` (keyboard nav, awaiting worklist, shift-range select) so
    // the range a shift-click spans matches exactly what's on screen.
    const sortDayRecords = (dayRecords: ShippedOrder[]): ShippedOrder[] =>
      [...dayRecords].sort((a, b) => {
        if (sort === 'newest') {
          const ta = new Date(a.created_at || a.deadline_at || 0).getTime();
          const tb = new Date(b.created_at || b.deadline_at || 0).getTime();
          return tb - ta;
        }
        if (queueMode === 'fulfillment') {
          const testedA = Boolean((a as QueueRowRecord).has_tech_scan) ? 0 : 1;
          const testedB = Boolean((b as QueueRowRecord).has_tech_scan) ? 0 : 1;
          if (testedA !== testedB) return testedA - testedB;
        }
        const timeA = new Date(a.deadline_at || a.created_at || 0).getTime();
        const timeB = new Date(b.deadline_at || b.created_at || 0).getTime();
        return timeA - timeB;
      });

    const sortedGroupedEntries = Object.entries(groupedRecords)
      // `newest` shows the most recent day band first; `priority` shows soonest.
      .sort((a, b) => (sort === 'newest' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
      .map(([date, dayRecords]) => [date, sortDayRecords(dayRecords)] as [string, ShippedOrder[]]);

    // Within each day, fold the lines that share ONE order number into a single
    // group → a multi-product order renders as one expandable header; the common
    // single-line case stays a plain row. groupRowsBy preserves the per-day sort
    // order.
    const orderGroupsByDate: [string, RowGroup<ShippedOrder>[]][] = sortedGroupedEntries.map(
      ([date, dayRecords]) => [
        date,
        groupRowsBy(dayRecords, (r) => String(r.order_id || '').trim() || `id:${r.id}`),
      ],
    );

    const displayedRecords = orderGroupsByDate.flatMap(([, groups]) => groups.flatMap((g) => g.rows));

    const totalCount = Object.values(groupedRecords).reduce((sum, dayRecords) => sum + dayRecords.length, 0);

    return { visibleRecords, orderGroupsByDate, displayedRecords, totalCount };
  }, [records, sort, queueMode]);
}
