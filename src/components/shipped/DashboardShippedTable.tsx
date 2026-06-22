'use client';

import { useCallback, useEffect, useRef } from 'react';
import { SkeletonList } from '@/design-system';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { useTableSelectMode } from '@/hooks/useTableSelectMode';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import type { DerivedPackerRecord } from '@/lib/shipped-records';
import { useShippedTableFilters } from '@/components/shipped/dashboard-table/useShippedTableFilters';
import { useShippedTableRecords } from '@/components/shipped/dashboard-table/useShippedTableRecords';
import { useShippedTableGrouping } from '@/components/shipped/dashboard-table/useShippedTableGrouping';
import { useShippedDetailsSelection } from '@/components/shipped/dashboard-table/useShippedDetailsSelection';
import { ShippedTableHeader } from '@/components/shipped/dashboard-table/ShippedTableHeader';
import { ShippedTableEmptyState } from '@/components/shipped/dashboard-table/ShippedTableEmptyState';
import { ShippedDateSection } from '@/components/shipped/dashboard-table/ShippedDateSection';

export interface DashboardShippedTableProps {
  packedBy?: number;
  testedBy?: number;
  /** Mobile tech/packer: one scroll column, no extra shell wrappers; WeekHeader matches other mobile week tables. */
  embedded?: boolean;
  /** Pencil multi-select: rows render checkboxes; the page owns the action bar. */
  selectMode?: boolean;
  bannerTitle?: DashboardSearchSectionProps['bannerTitle'];
  bannerSubtitle?: DashboardSearchSectionProps['bannerSubtitle'];
  searchEmptyTitle?: DashboardSearchSectionProps['searchEmptyTitle'];
  searchResultLabel?: DashboardSearchSectionProps['searchResultLabel'];
  clearSearchLabel?: DashboardSearchSectionProps['clearSearchLabel'];
}

export function DashboardShippedTable({
  packedBy,
  testedBy,
  embedded = false,
  selectMode = false,
  bannerTitle,
  bannerSubtitle,
  searchEmptyTitle = 'No shipped orders found',
  searchResultLabel = 'shipped orders',
  clearSearchLabel = 'Show All Shipped Orders',
}: DashboardShippedTableProps = {}) {
  const { isMobile } = useUIModeOptional();
  const scrollRef = useRef<HTMLDivElement>(null);

  const filters = useShippedTableFilters({ packedBy, testedBy });
  const { query, derivedRecords, searchMeta, isResolvingSearch } = useShippedTableRecords(filters);
  const { daySections, orderedRecords, totalCount } = useShippedTableGrouping(derivedRecords);
  const { selectedDetailId, handleRowClick } = useShippedDetailsSelection({ orderedRecords });

  // Pencil multi-select wiring (off by default → no-op for non-select callers).
  const getRowId = useCallback((r: DerivedPackerRecord) => Number(r.id), []);
  const { selectedIds, toggle } = useTableSelectMode<DerivedPackerRecord>({
    scope: DASHBOARD_ORDERS_SELECTION_SCOPE,
    selectMode,
    rows: orderedRecords,
    getId: getRowId,
  });

  useEffect(() => {
    // Reset to the top of the list when the week / filter changes so a new
    // window opens at its first day rather than wherever the prior scroll sat.
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
  }, [daySections]);

  const isBusy = (query.isFetching && !query.isLoading) || isResolvingSearch;
  const showResultsHeader = Boolean(filters.normalizedSearch) || filters.anyCarrierFilter;

  const shippedTableInner = (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <ShippedTableHeader
        bannerTitle={bannerTitle}
        bannerSubtitle={bannerSubtitle}
        isBusy={isBusy}
        showResultsHeader={showResultsHeader}
        totalCount={totalCount}
        weekRange={filters.weekRange}
        weekOffset={filters.weekOffset}
        onPrevWeek={() => filters.setWeekOffset(filters.weekOffset + 1)}
        onNextWeek={() => filters.setWeekOffset(Math.max(0, filters.weekOffset - 1))}
      />

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-x-auto overflow-y-auto no-scrollbar w-full"
      >
        {query.isLoading ? (
          <SkeletonList count={12} />
        ) : daySections.length === 0 ? (
          <ShippedTableEmptyState
            search={filters.search}
            searchEmptyTitle={searchEmptyTitle ?? 'No shipped orders found'}
            searchResultLabel={searchResultLabel ?? 'shipped orders'}
            clearSearchLabel={clearSearchLabel ?? 'Show All Shipped Orders'}
            onClearSearch={filters.clearSearch}
            searchMeta={searchMeta}
            onApplySuggestedFilter={filters.applyShippedFilter}
          />
        ) : (
          <div className="flex flex-col w-full">
            {daySections.map(([date, records]) => (
              <ShippedDateSection
                key={date}
                date={date}
                records={records}
                isMobile={isMobile}
                selectMode={selectMode}
                selectedIds={selectedIds}
                selectedDetailId={selectedDetailId}
                onRowClick={handleRowClick}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">{shippedTableInner}</div>;
  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 bg-white relative">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{shippedTableInner}</div>
      </div>
    </div>
  );
}
