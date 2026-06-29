'use client';

import type { ReactNode } from 'react';
import { SkeletonList } from '@/design-system';
import { Loader2 } from '@/components/Icons';
import DateRangeHeader from '@/components/ui/DateRangeHeader';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { sumDaySectionCounts } from '@/components/station/station-table-logic';
import { TableColumnConfigProvider } from '@/components/ui/table-column-config/TableColumnConfig';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';
import type { TableId } from '@/lib/tables/table-columns';

export interface StationWeekTableProps<T> {
  loading: boolean;
  isRefreshing: boolean;
  weekRange: ReturnType<typeof getWeekRangeForOffset>;
  weekOffset: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  /** `[date, records]` bands, newest day first, each day's rows pre-sorted. */
  daySections: [string, T[]][];
  /** Message shown when there are no records for the week. */
  emptyMessage: string;
  /** Scroll container ref (owned by the table controller for scroll resets). */
  scrollRef: React.Ref<HTMLDivElement>;
  /** Render one row. Receives the record, its in-day index, and the day key. */
  renderRow: (record: T, index: number, date: string) => ReactNode;
  /**
   * When set, the table is wrapped in a per-staff column-config provider and the
   * header gains a "Columns" control — so the shared ChipColumns/RowMetaColumns
   * primitives drop columns this staffer has hidden for this table.
   */
  tableId?: TableId;
}

/**
 * Shared shell for the station week tables (Tech / Packer): a refresh spinner,
 * the {@link DateRangeHeader}, a scroll container, and the date-banded list. The
 * caller supplies the day sections and a `renderRow` — everything else (chrome,
 * loading skeleton, empty state, week count) is identical across stations.
 */
export function StationWeekTable<T>({
  loading,
  isRefreshing,
  weekRange,
  weekOffset,
  onPrevWeek,
  onNextWeek,
  daySections,
  emptyMessage,
  scrollRef,
  renderRow,
  tableId,
}: StationWeekTableProps<T>) {
  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        <div className="h-10 bg-white border-b border-gray-100 flex items-center px-4">
          <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <SkeletonList count={12} />
        </div>
      </div>
    );
  }

  const weekCount = sumDaySectionCounts(daySections);

  const body = (
    <div className="relative flex h-full w-full bg-white">
      {isRefreshing && (
        <div className="absolute right-2 top-2 z-30">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <DateRangeHeader
          count={weekCount}
          columns={tableId ? <ColumnConfigButton iconOnly /> : undefined}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={onPrevWeek}
          onNextWeek={onNextWeek}
        />
        <div ref={scrollRef} data-testid="column-table-body" className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {daySections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <p className="font-medium italic text-gray-500 opacity-20">{emptyMessage}</p>
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {daySections.map(([date, records]) => (
                <div key={date} className="flex flex-col">
                  <DateGroupHeader date={date} total={records.length} />
                  {records.map((record, index) => renderRow(record, index, date))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return tableId ? (
    <TableColumnConfigProvider tableId={tableId}>{body}</TableColumnConfigProvider>
  ) : (
    body
  );
}
