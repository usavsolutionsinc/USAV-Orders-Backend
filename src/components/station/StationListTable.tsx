'use client';

import { useRef, type ReactNode, type RefObject } from 'react';
import { sectionLabel, SkeletonList } from '@/design-system';
import { Button } from '@/design-system/primitives';
import { Loader2 } from '@/components/Icons';
import DateRangeHeader from '@/components/ui/DateRangeHeader';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { QueueTableBanner } from '@/components/dashboard/orders-queue/QueueTableBanner';
import { VirtualGroupedSections } from '@/components/dashboard/orders-queue/VirtualGroupedSections';
import type { WeekRange } from '@/components/dashboard/orders-queue/helpers';
import type { RowGroup } from '@/lib/group-rows';

/**
 * `StationListTable<TRecord>` — the generic, record-agnostic day-banded list shell
 * for the station/history tables (Tech, Packer, Receiving history/incoming,
 * Testing history). It is the generalization of {@link OrdersQueueTable}'s
 * scaffold: the 40px header band (week nav + ⋮/columns slots), the scroll body
 * (self-scrolling OR an ancestor-scroll stacked lane), the virtualized ⇄ dense
 * branch, and the typed empty/first-run/search states — with the row + grouping
 * INJECTED (`renderRow` / `renderGroup`) so the surface owns only its row anatomy.
 *
 * Grouping is caller-built (by that surface's controller): pass `orderGroupsByDate`
 * (folded order groups, with a `renderGroup`) OR `daySections` (flat rows). All
 * windowing / sticky-header / stacked-lane ancestor-scroll mechanics come from
 * {@link VirtualGroupedSections}. Row density comes from a `TableDensityProvider`
 * mounted by the consumer (rows read it via `useTableDensity`), same as columns.
 */
export interface StationListTableProps<TRecord> {
  loading: boolean;
  isRefreshing?: boolean;

  /** Grouped mode: date bands → folded order groups (pass `renderGroup`). */
  orderGroupsByDate?: [string, RowGroup<TRecord>[]][];
  /** Flat mode: date bands → rows (testing history, station logs). */
  daySections?: [string, TRecord[]][];
  /** Count shown in the header (dated, visible records). */
  totalCount: number;

  /** Render one row at the given zebra-stripe index. */
  renderRow: (record: TRecord, stripeIndex: number) => ReactNode;
  /** Grouped mode: render one order group (singleton/multi-product fold). */
  renderGroup?: (group: RowGroup<TRecord>, baseStripeIndex: number) => ReactNode;
  /** Stable key for a flat row (id) so windowing survives re-sorts. */
  getRowKey?: (record: TRecord, dayIndex: number) => string;

  // Week controls (optional — testing/tech/packer/receiving history).
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onResetWeek?: () => void;
  showWeekControls?: boolean;

  // Header band.
  hideHeader?: boolean;
  /** Column-config button, rendered in the header's `columns` slot. */
  headerColumnsSlot?: ReactNode;
  /** Pipeline/All toggle + ⋮ menu, rendered on the header's right. */
  headerEndSlot?: ReactNode;
  bannerTitle?: string;
  bannerSubtitle?: string;
  bannerCompact?: boolean;

  // Body sizing / virtualization.
  virtualized?: boolean;
  /** Stacked SwimlaneBoard lane: window against this shared ancestor scroll region. */
  scrollParentRef?: RefObject<HTMLElement | null>;
  autoHeight?: boolean;
  maxBodyHeightClass?: string;
  maxBodyHeightPx?: number;
  growToContent?: boolean;
  noHorizontalScroll?: boolean;

  // Empty / search.
  searchValue?: string;
  onClearSearch?: () => void;
  emptyMessage: string;
  /** Typed first-run empty (zero rows, no search) — teaches instead of faint text. */
  firstRunEmpty?: ReactNode;
  searchEmptyTitle?: string;
  searchResultLabel?: string;
  clearSearchLabel?: string;

  footer?: ReactNode;
}

export function StationListTable<TRecord>({
  loading,
  isRefreshing = false,
  orderGroupsByDate,
  daySections,
  totalCount,
  renderRow,
  renderGroup,
  getRowKey,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  onResetWeek,
  showWeekControls = false,
  hideHeader = false,
  headerColumnsSlot,
  headerEndSlot,
  bannerTitle,
  bannerSubtitle,
  bannerCompact = false,
  virtualized = false,
  scrollParentRef,
  autoHeight = false,
  maxBodyHeightClass,
  maxBodyHeightPx,
  growToContent = false,
  noHorizontalScroll = false,
  searchValue = '',
  onClearSearch,
  emptyMessage,
  firstRunEmpty,
  searchEmptyTitle = 'Not found',
  searchResultLabel = 'records',
  clearSearchLabel = 'Show all',
  footer,
}: StationListTableProps<TRecord>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Body class logic mirrors OrdersQueueTable so the two scaffolds scroll identically.
  const rootClass = autoHeight
    ? 'flex min-w-0 w-full bg-surface-card relative'
    : 'flex h-full min-w-0 flex-1 bg-surface-card relative';
  const columnClass = autoHeight ? 'flex flex-col w-full min-w-0' : 'flex-1 flex flex-col overflow-hidden';
  const xScroll = noHorizontalScroll ? 'overflow-x-hidden' : 'overflow-x-auto';
  const bodyScrollClass = autoHeight
    ? growToContent
      ? 'overflow-x-clip w-full'
      : `${xScroll} overflow-y-auto no-scrollbar w-full ${maxBodyHeightPx == null ? maxBodyHeightClass ?? '' : ''}`
    : `flex-1 ${xScroll} overflow-y-auto no-scrollbar w-full`;
  const bodyScrollStyle =
    autoHeight && !growToContent && maxBodyHeightPx != null ? { maxHeight: maxBodyHeightPx } : undefined;
  const emptyPadClass = autoHeight ? 'py-10' : 'py-40';

  const dayBands = orderGroupsByDate ?? daySections ?? [];
  const isEmpty = dayBands.length === 0;

  if (loading) {
    return (
      <div className={autoHeight ? 'flex flex-col bg-surface-canvas' : 'flex-1 flex flex-col bg-surface-canvas overflow-hidden'}>
        {hideHeader ? null : bannerTitle ? (
          <QueueTableBanner title={bannerTitle} subtitle={bannerSubtitle} compact={bannerCompact} />
        ) : (
          <div className="h-10 bg-surface-card border-b border-border-hairline flex items-center px-4">
            <div className="h-4 w-32 bg-surface-sunken rounded animate-pulse" />
          </div>
        )}
        <div
          className={autoHeight ? `overflow-y-auto no-scrollbar ${maxBodyHeightPx == null ? maxBodyHeightClass ?? '' : ''}` : 'flex-1 overflow-y-auto no-scrollbar'}
          style={bodyScrollStyle}
        >
          <SkeletonList count={autoHeight ? 6 : 12} />
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <div className={columnClass}>
        {hideHeader ? null : bannerTitle ? (
          <QueueTableBanner title={bannerTitle} subtitle={bannerSubtitle} compact={bannerCompact} isRefreshing={isRefreshing} />
        ) : (
          <DateRangeHeader
            count={totalCount}
            columns={headerColumnsSlot}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={onPrevWeek}
            onNextWeek={onNextWeek}
            rightSlot={
              headerEndSlot ?? (!showWeekControls ? (
                <div className="min-w-[18px] flex items-center justify-end">
                  {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
                </div>
              ) : undefined)
            }
          />
        )}

        <div ref={scrollRef} data-testid="column-table-body" className={bodyScrollClass} style={bodyScrollStyle}>
          {isEmpty ? (
            <div className={`flex flex-col items-center justify-center ${emptyPadClass} text-center`}>
              {searchValue ? (
                <OrderSearchEmptyState
                  query={searchValue}
                  title={searchEmptyTitle}
                  resultLabel={searchResultLabel}
                  clearLabel={clearSearchLabel}
                  onClear={onClearSearch ?? (() => {})}
                />
              ) : firstRunEmpty ? (
                <div className="mx-auto animate-in fade-in zoom-in duration-300">{firstRunEmpty}</div>
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-text-soft font-semibold italic opacity-20">{emptyMessage}</p>
                  {showWeekControls && weekOffset > 0 && onResetWeek ? (
                    <Button
                      type="button"
                      variant="brand"
                      onClick={onResetWeek}
                      className={`mt-4 bg-none bg-surface-inverse px-6 ${sectionLabel} text-white hover:bg-surface-inverse-hover`}
                    >
                      Go to Current Week
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ) : virtualized ? (
            <VirtualGroupedSections<TRecord>
              orderGroupsByDate={orderGroupsByDate}
              daySections={daySections}
              scrollParentRef={scrollParentRef ?? scrollRef}
              useAncestorScroll={Boolean(scrollParentRef)}
              renderRow={renderRow}
              renderGroup={renderGroup}
              getRowKey={getRowKey}
            />
          ) : (
            <div className="flex flex-col w-full">
              {dayBands.map(([date, groupsOrRows]) => (
                <DenseDaySection<TRecord>
                  key={date}
                  date={date}
                  groupsOrRows={groupsOrRows}
                  renderRow={renderRow}
                  renderGroup={renderGroup}
                />
              ))}
            </div>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
}

/** Dense (non-virtualized) day section — header + groups OR flat rows. */
function DenseDaySection<TRecord>({
  date,
  groupsOrRows,
  renderRow,
  renderGroup,
}: {
  date: string;
  groupsOrRows: RowGroup<TRecord>[] | TRecord[];
  renderRow: (record: TRecord, stripeIndex: number) => ReactNode;
  renderGroup?: (group: RowGroup<TRecord>, baseStripeIndex: number) => ReactNode;
}) {
  const isGrouped = renderGroup != null && groupsOrRows.length > 0 && isRowGroup(groupsOrRows[0]);
  const dayTotal = isGrouped
    ? (groupsOrRows as RowGroup<TRecord>[]).reduce((sum, g) => sum + g.rows.length, 0)
    : groupsOrRows.length;

  let stripeIndex = 0;
  return (
    <div className="flex flex-col">
      <DateGroupHeader date={date} total={dayTotal} />
      {isGrouped
        ? (groupsOrRows as RowGroup<TRecord>[]).map((group) => {
            const base = stripeIndex;
            stripeIndex += group.rows.length;
            return <div key={`g:${group.key}`}>{renderGroup!(group, base)}</div>;
          })
        : (groupsOrRows as TRecord[]).map((record, i) => <div key={`r:${i}`}>{renderRow(record, i)}</div>)}
    </div>
  );
}

function isRowGroup<TRecord>(value: RowGroup<TRecord> | TRecord): value is RowGroup<TRecord> {
  return typeof value === 'object' && value != null && 'rows' in value && Array.isArray((value as RowGroup<TRecord>).rows);
}
