'use client';

import { useCallback, useEffect, useRef } from 'react';
import { SkeletonList } from '@/design-system';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { useTableSelectMode } from '@/hooks/useTableSelectMode';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import { formatWeekRangeCompact } from '@/utils/date';
import { AlertTriangle, Clock, Loader2, MapPin, Package, PackageCheck, Send, Truck } from '@/components/Icons';
import { OUTBOUND_STATE_META, type OutboundState } from '@/lib/outbound-state';
import { OUTBOUND_BOARD_LANES, type OutboundLaneIconKey } from '@/lib/order-lifecycle';
import type { DerivedPackerRecord } from '@/lib/shipped-records';
import { useShippedTableFilters, type ShippedLayout } from '@/components/shipped/dashboard-table/useShippedTableFilters';
import { useShippedTableRecords } from '@/components/shipped/dashboard-table/useShippedTableRecords';
import { useShippedTableGrouping } from '@/components/shipped/dashboard-table/useShippedTableGrouping';
import { useShippedDetailsSelection } from '@/components/shipped/dashboard-table/useShippedDetailsSelection';
import { useShippedPeriodControls } from '@/components/shipped/dashboard-table/useShippedPeriodControls';
import { ShippedTableHeader } from '@/components/shipped/dashboard-table/ShippedTableHeader';
import { ShippedTableEmptyState } from '@/components/shipped/dashboard-table/ShippedTableEmptyState';
import { ShippedDateSection } from '@/components/shipped/dashboard-table/ShippedDateSection';
import { ShippedLaneTable } from '@/components/shipped/dashboard-table/ShippedLaneTable';
import { SwimlaneBoard, type SwimlaneLaneDef } from '@/components/board/SwimlaneBoard';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { TableColumnConfigProvider } from '@/components/ui/table-column-config/TableColumnConfig';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';
import { DateRangePickerPill } from '@/components/ui/DateRangeHeader';

/** Icon binding — maps the lib's outbound lane icon key to a concrete glyph. */
const OUTBOUND_LANE_ICON: Record<OutboundLaneIconKey, React.ComponentType<{ className?: string }>> = {
  staged: Clock,
  scanned_out: Send,
  in_custody: Truck,
  delivered: PackageCheck,
  exception: AlertTriangle,
  process_gap: Package,
  orphan: MapPin,
};

/** Pipeline ⇄ All view toggle — same DS segmented control (`nav`) as the board's
 *  column switcher, so the two header controls share one visual language. */
const SHIPPED_VIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'board', label: 'Pipeline' },
  { id: 'all', label: 'All' },
];

/**
 * Lane model handed to the board. Lane ORDER + icon binding come from the
 * canonical `OUTBOUND_BOARD_LANES` descriptor (`order-lifecycle.ts`); the
 * label/dot/description come from the `OUTBOUND_STATE_META` color SoT.
 */
const SHIPPED_LANES: SwimlaneLaneDef<OutboundState>[] = OUTBOUND_BOARD_LANES.map((lane) => ({
  id: lane.id,
  label: OUTBOUND_STATE_META[lane.id].label,
  dot: OUTBOUND_STATE_META[lane.id].dot,
  description: OUTBOUND_STATE_META[lane.id].description,
  icon: OUTBOUND_LANE_ICON[lane.iconKey],
}));

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

  // Week/month/custom period picker controls — shared by the list header, the
  // board header pill, and the "All" header pill so all three behave identically.
  const period = useShippedPeriodControls(filters);
  const periodRange = period.activeRange ?? filters.weekRange;
  const periodLabel = formatWeekRangeCompact(periodRange.startStr, periodRange.endStr);

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

  // View mode for the shipped surface (owner/manager history use case).
  // "Pipeline" (board with outbound-state lanes) is primary; "All" is the flat
  // chronological history list. URL-backed (`?layout=`) via the filters hook so a
  // shared link / reload reproduces the exact view — not ephemeral component state.
  const shippedView = filters.layout;

  const viewToggle = (
    <HorizontalButtonSlider
      items={SHIPPED_VIEW_ITEMS}
      value={shippedView}
      onChange={(id) => filters.setLayout(id as ShippedLayout)}
      variant="nav"
      dense
      aria-label="Shipped view"
    />
  );

  // Shared day-banded list body (loading → empty → grouped rows). Both the embedded
  // mobile surface and the desktop "All" lens render this identical block; only the
  // list wrapper's padding differs, so it's the one parameter.
  const renderDayBandedBody = (listClassName: string) =>
    query.isLoading ? (
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
      <div className={listClassName}>
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
    );

  const shippedTableInner = (
    <TableColumnConfigProvider tableId="shipped">
    <div className="flex-1 flex flex-col min-h-0 relative">
      <ShippedTableHeader
        bannerTitle={bannerTitle}
        bannerSubtitle={bannerSubtitle}
        isBusy={isBusy}
        showResultsHeader={showResultsHeader}
        totalCount={totalCount}
        weekRange={filters.weekRange}
        period={period}
      />

      <div
        ref={scrollRef}
        data-testid="column-table-body"
        className="flex-1 min-h-0 overflow-x-auto overflow-y-auto no-scrollbar w-full"
      >
        {renderDayBandedBody('flex flex-col w-full px-2 pb-8')}
      </div>
    </div>
    </TableColumnConfigProvider>
  );

  // Board layout (`?layout=board`) — same fetch + selection, re-grouped into
  // outbound-state lanes. The date+filter pill (week/month/custom) lives in the
  // board header; the columns icon is pinned top-right. Lanes have no per-lane
  // sort/date control. Each lane body is a content-sized ShippedLaneTable.
  const shippedBoardInner = (
    <TableColumnConfigProvider tableId="shipped">
      <SwimlaneBoard<DerivedPackerRecord, OutboundState, never>
        prefsKey="shippedBoard"
        lanes={SHIPPED_LANES}
        bucket={(r) => r.outboundState}
        records={derivedRecords}
        maxColumns={2}
        headerEndSlot={
          <div className="flex items-center gap-2">
            <DateRangePickerPill
              label={periodLabel}
              presets={period.presets}
              onSelectCustomRange={period.onSelectCustomRange}
              activeRange={period.activeRange}
              onClear={period.onClear}
            />
            {viewToggle}
            <ColumnConfigButton iconOnly />
          </div>
        }
        renderLaneBody={({ rows, laneLabel, maxBodyHeightClass, maxBodyHeightPx, growToContent }) => (
          <ShippedLaneTable
            records={rows}
            loading={query.isLoading}
            isMobile={isMobile}
            selectMode={selectMode}
            selectedIds={selectedIds}
            selectedDetailId={selectedDetailId}
            onRowClick={handleRowClick}
            onToggle={toggle}
            maxBodyHeightClass={maxBodyHeightClass}
            maxBodyHeightPx={maxBodyHeightPx}
            growToContent={growToContent}
            emptyMessage={`No ${laneLabel.toLowerCase()} orders`}
          />
        )}
      />
    </TableColumnConfigProvider>
  );

  // Desktop dashboard is board-only; the embedded (mobile) variant keeps the
  // dense day-banded list — a drag-reorder / resize board isn't a phone surface.
  if (embedded) return <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">{shippedTableInner}</div>;

  const mainContent = shippedView === 'all' ? (
    <TableColumnConfigProvider tableId="shipped">
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex h-[40px] shrink-0 items-center justify-between gap-3 border-b border-gray-300 px-3">
          <div className="flex items-center gap-3">
            <DateRangePickerPill
              label={periodLabel}
              count={totalCount}
              presets={period.presets}
              onSelectCustomRange={period.onSelectCustomRange}
              activeRange={period.activeRange}
              onClear={period.onClear}
            />
          </div>
          <div className="flex items-center gap-2">
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
            {viewToggle}
            <ColumnConfigButton iconOnly />
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto no-scrollbar px-2 pb-8">
          {renderDayBandedBody('flex flex-col w-full')}
        </div>
      </div>
    </TableColumnConfigProvider>
  ) : shippedBoardInner;

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 bg-white relative">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mainContent}
        </div>
      </div>
    </div>
  );
}
