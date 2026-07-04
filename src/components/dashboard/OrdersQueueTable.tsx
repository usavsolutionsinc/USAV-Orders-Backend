'use client';

import { useCallback, useRef, type ReactNode } from 'react';
import { sectionLabel, SkeletonList } from '@/design-system';
import { Button } from '@/design-system/primitives';
import { Loader2 } from '@/components/Icons';
import { useTableSelectMode } from '@/hooks/useTableSelectMode';
import DateRangeHeader from '@/components/ui/DateRangeHeader';
import { getDaysLateNullable } from '@/utils/date';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { AddTrackingPopover } from '@/components/outbound/labels/AddTrackingPopover';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import {
  normalizePersonName,
  resolveRowStatus,
  type OrdersQueueMode,
  type OrdersQueueSort,
  type QueueRowRecord,
  type WeekRange,
} from '@/components/dashboard/orders-queue/helpers';
import { OrdersQueueTableRow } from '@/components/dashboard/orders-queue/OrdersQueueTableRow';
import { QueueTableBanner } from '@/components/dashboard/orders-queue/QueueTableBanner';
import { QueueDateSection } from '@/components/dashboard/orders-queue/QueueDateSection';
import { useOrdersQueueRows } from '@/components/dashboard/orders-queue/useOrdersQueueRows';
import { useOrdersQueueSelection } from '@/components/dashboard/orders-queue/useOrdersQueueSelection';
import { TableColumnConfigProvider } from '@/components/ui/table-column-config/TableColumnConfig';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';

// Re-exported so existing importers keep their `@/components/dashboard/OrdersQueueTable` path.
export type { OrdersQueueMode, OrdersQueueSort } from '@/components/dashboard/orders-queue/helpers';

export interface OrdersQueueTableProps {
  records: ShippedOrder[];
  loading: boolean;
  isRefreshing: boolean;
  searchValue: string;
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onResetWeek?: () => void;
  showWeekControls?: boolean;
  onClearSearch: () => void;
  emptyMessage: string;
  /** Typed first-run empty (zero rows, no active search). When provided it
   *  replaces the faint `emptyMessage` text — used to teach a brand-new org and
   *  offer a "connect a channel" CTA instead of a blank-looking board. Omitted
   *  by per-lane embedders so empty lanes keep the quiet faint text. */
  firstRunEmpty?: ReactNode;
  searchEmptyTitle?: string;
  searchResultLabel?: string;
  clearSearchLabel?: string;
  bannerTitle?: string;
  bannerSubtitle?: string;
  /** Single-line 40px banner row (title + subtitle on one line). */
  bannerCompact?: boolean;
  onOpenRecord?: (record: ShippedOrder) => void;
  onCloseRecord?: (record: ShippedOrder | null) => void;
  /** When true, display tester/packer from work_assignments (tester_id, packer_id) only */
  useWaForDisplay?: boolean;
  /** Sort order (default `priority`). Driven by `?sort` on the merged Unshipped mode. */
  sort?: OrdersQueueSort;
  /** Pencil multi-select: rows render checkboxes and click toggles instead of
   *  opening the detail. Off by default so other consumers are unaffected. */
  selectMode?: boolean;
  /** Selection scope shared with the page's useTableSelection + action bar.
   *  Required when `selectMode` is on. */
  selectionScope?: string;
  /** Surface-specific row chrome (fulfillment / labels / staged). */
  queueMode?: OrdersQueueMode;
  /** Suppress the built-in WeekHeader/banner so an embedder (e.g. the shelf-board
   *  bubble cards) can supply its own header. Body + scroll behavior unchanged. */
  hideHeader?: boolean;
  /** Clip horizontal overflow instead of scrolling it (no bottom scrollbar).
   *  Used by the shelf-board bubbles, which are vertical-only. */
  noHorizontalScroll?: boolean;
  /** Size the body to its CONTENT up to a max (instead of filling a fixed-height
   *  parent). The scroll body becomes `max-h` + `overflow-y-auto`, so a short
   *  table leaves no empty space and a long one scrolls. Used by the shelf-board
   *  bubbles. Pair with `maxBodyHeightClass` (default) or `maxBodyHeightPx`. */
  autoHeight?: boolean;
  /** Tailwind max-height utility for the `autoHeight` body (e.g. `max-h-[70vh]`).
   *  Ignored when `maxBodyHeightPx` is set. */
  maxBodyHeightClass?: string;
  /** Explicit px cap for the `autoHeight` body — wins over `maxBodyHeightClass`.
   *  Drives the drag-to-resize handle on the shelf-board bubbles. */
  maxBodyHeightPx?: number;
  /** When true (only meaningful with `autoHeight`), the body grows to its full
   *  content with NO internal vertical scroll or max-height — an ancestor scroll
   *  region owns the scroll. Used by stacked (1-up) SwimlaneBoard lanes so the
   *  whole board scrolls as one region instead of trapping the wheel per lane. */
  growToContent?: boolean;
  /** When true, skip the internal {@link TableColumnConfigProvider} — a parent
   *  (e.g. {@link UnshippedShelfBoard}) owns the provider + Columns control. */
  inheritColumnConfig?: boolean;
}

export function OrdersQueueTable({
  records,
  loading,
  isRefreshing,
  searchValue,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  onResetWeek,
  showWeekControls = false,
  onClearSearch,
  emptyMessage,
  firstRunEmpty,
  searchEmptyTitle = 'Order not found',
  searchResultLabel = 'records',
  clearSearchLabel = 'Show All Orders',
  bannerTitle,
  bannerSubtitle,
  bannerCompact = false,
  onOpenRecord,
  onCloseRecord,
  useWaForDisplay = false,
  sort = 'priority',
  selectMode = false,
  selectionScope = 'orders-queue',
  queueMode = 'fulfillment',
  hideHeader = false,
  noHorizontalScroll = false,
  autoHeight = false,
  maxBodyHeightClass,
  maxBodyHeightPx,
  growToContent = false,
  inheritColumnConfig = false,
}: OrdersQueueTableProps) {
  const { isMobile } = useUIModeOptional();
  const { getStaffName } = useStaffNameMap();
  const scrollRef = useRef<HTMLDivElement>(null);

  // `autoHeight`: the body sizes to content, capped by a max-height (px wins over
  // class), so short tables leave no trailing whitespace and tall ones scroll.
  const rootClass = autoHeight
    ? 'flex min-w-0 w-full bg-surface-card relative'
    : 'flex h-full min-w-0 flex-1 bg-surface-card relative';
  const columnClass = autoHeight
    ? 'flex flex-col w-full min-w-0'
    : 'flex-1 flex flex-col overflow-hidden';
  const xScroll = noHorizontalScroll ? 'overflow-x-hidden' : 'overflow-x-auto';
  // `growToContent` (stacked lanes): no internal vertical scroll / cap — the body
  // grows to content and an ancestor scroll region owns the wheel. Otherwise the
  // body scrolls internally, capped by the px (drag) or class (preset) height.
  const bodyScrollClass = autoHeight
    ? growToContent
      // `overflow-x-clip` (NOT hidden): clips horizontally without becoming a
      // scroll container, so it doesn't trap the sticky DateGroupHeader — the
      // header promotes to the board's scroll region and docks at the top.
      ? 'overflow-x-clip w-full'
      : `${xScroll} overflow-y-auto no-scrollbar w-full ${maxBodyHeightPx == null ? maxBodyHeightClass ?? '' : ''}`
    : `flex-1 ${xScroll} overflow-y-auto no-scrollbar w-full`;
  const bodyScrollStyle =
    autoHeight && !growToContent && maxBodyHeightPx != null ? { maxHeight: maxBodyHeightPx } : undefined;
  const emptyPadClass = autoHeight ? 'py-10' : 'py-40';

  const { visibleRecords, orderGroupsByDate, displayedRecords, totalCount } = useOrdersQueueRows({
    records,
    sort,
    queueMode,
  });

  const { selectedRecord, handleRowClick } = useOrdersQueueSelection({
    visibleRecords,
    displayedRecords,
    onOpenRecord,
    onCloseRecord,
  });

  // Pencil multi-select wiring (off by default → no-op for non-select callers).
  const getRowId = useCallback((r: ShippedOrder) => Number(r.id), []);
  const { selectedIds, toggle } = useTableSelectMode<ShippedOrder>({
    scope: selectionScope,
    selectMode,
    rows: displayedRecords,
    getId: getRowId,
  });

  // In select mode a click toggles the checkbox instead of opening the detail;
  // shift-click extends the range from the last-clicked anchor.
  const handleRowAction = useCallback(
    (record: ShippedOrder, event?: { shiftKey: boolean }) => {
      if (selectMode) {
        toggle(Number(record.id), event?.shiftKey ?? false);
        return;
      }
      handleRowClick(record);
    },
    [selectMode, toggle, handleRowClick],
  );

  // Render one queue row. Shared by the flat (single-line) case and the children
  // of a multi-product order group, so both paths resolve tester/packer + flags
  // identically. `stripeIndex` continues across a day (incl. group children) so
  // zebra striping stays consistent.
  const renderRow = useCallback(
    (record: ShippedOrder, stripeIndex: number) => {
      const r = record as QueueRowRecord;
      const testerName = useWaForDisplay
        ? getStaffName(r.tester_id as number | null | undefined)
        : (r.tested_by_name as string | undefined) ||
          (r.tester_name as string | undefined) ||
          getStaffName(r.tested_by as number | null | undefined) ||
          getStaffName(r.tester_id as number | null | undefined);
      const packerName = useWaForDisplay
        ? getStaffName(r.packer_id as number | null | undefined)
        : (r.packed_by_name as string | undefined) ||
          (r.packer_name as string | undefined) ||
          getStaffName(r.packed_by as number | null | undefined) ||
          getStaffName(r.packer_id as number | null | undefined);
      const outOfStockValue = String(r.out_of_stock || '').trim();
      const rowStatus = resolveRowStatus(r, queueMode);
      return (
        <OrdersQueueTableRow
          key={record.id}
          record={r}
          isSelected={selectMode ? selectedIds.has(Number(record.id)) : selectedRecord?.id === record.id}
          selectMode={selectMode}
          isChecked={selectMode && selectedIds.has(Number(record.id))}
          isMobile={isMobile}
          useAlternateStripe={stripeIndex % 2 === 0}
          testerDisplay={normalizePersonName(testerName)}
          packerDisplay={normalizePersonName(packerName)}
          testerId={useWaForDisplay ? (r.tester_id as number | null) : (r.tested_by as number | null) ?? (r.tester_id as number | null)}
          packerId={useWaForDisplay ? (r.packer_id as number | null) : (r.packed_by as number | null) ?? (r.packer_id as number | null)}
          rowStatus={rowStatus}
          trackingAction={queueMode === 'labels' ? <AddTrackingPopover record={record} /> : undefined}
          hasOutOfStock={outOfStockValue !== ''}
          outOfStockValue={outOfStockValue}
          daysLate={getDaysLateNullable(r.deadline_at as string | null | undefined)}
          onRowClick={handleRowAction}
        />
      );
    },
    [getStaffName, useWaForDisplay, selectMode, selectedIds, selectedRecord, isMobile, handleRowAction, queueMode],
  );

  const wrapColumnConfig = (node: ReactNode) =>
    inheritColumnConfig ? node : (
      <TableColumnConfigProvider tableId="orders">{node}</TableColumnConfigProvider>
    );

  if (loading) {
    return wrapColumnConfig(
      <div className={autoHeight ? 'flex flex-col bg-surface-canvas' : 'flex-1 flex flex-col bg-surface-canvas overflow-hidden'}>
        {hideHeader ? null : bannerTitle ? (
          <QueueTableBanner
            title={bannerTitle}
            subtitle={bannerSubtitle}
            compact={bannerCompact}
          />
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
      </div>,
    );
  }

  return wrapColumnConfig(
    <div className={rootClass}>
      <div className={columnClass}>
        {hideHeader ? null : bannerTitle ? (
          <QueueTableBanner
            title={bannerTitle}
            subtitle={bannerSubtitle}
            compact={bannerCompact}
            isRefreshing={isRefreshing}
          />
        ) : (
          <DateRangeHeader
            count={totalCount}
            columns={<ColumnConfigButton iconOnly />}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={onPrevWeek}
            onNextWeek={onNextWeek}
            rightSlot={
              !showWeekControls
                ? <div className="min-w-[18px] flex items-center justify-end">{isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}</div>
                : undefined
            }
          />
        )}

        <div ref={scrollRef} data-testid="column-table-body" className={bodyScrollClass} style={bodyScrollStyle}>
          {orderGroupsByDate.length === 0 ? (
            <div className={`flex flex-col items-center justify-center ${emptyPadClass} text-center`}>
              {searchValue ? (
                <OrderSearchEmptyState
                  query={searchValue}
                  title={searchEmptyTitle}
                  resultLabel={searchResultLabel}
                  clearLabel={clearSearchLabel}
                  onClear={onClearSearch}
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
          ) : (
            <div className="flex flex-col w-full">
              {orderGroupsByDate.map(([date, groups]) => (
                <QueueDateSection
                  key={date}
                  date={date}
                  groups={groups}
                  isMobile={isMobile}
                  renderRow={renderRow}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
  );
}
