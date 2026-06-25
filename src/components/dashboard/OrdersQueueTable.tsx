'use client';

import { useCallback, useRef } from 'react';
import { sectionLabel, SkeletonList } from '@/design-system';
import { Loader2 } from '@/components/Icons';
import { useTableSelectMode } from '@/hooks/useTableSelectMode';
import WeekHeader from '@/components/ui/WeekHeader';
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
  /** Day-header style — `band` (default) or the slim `chip` used by the board. */
  dateHeaderVariant?: 'band' | 'chip';
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
  dateHeaderVariant = 'band',
  noHorizontalScroll = false,
  autoHeight = false,
  maxBodyHeightClass,
  maxBodyHeightPx,
}: OrdersQueueTableProps) {
  const { isMobile } = useUIModeOptional();
  const { getStaffName } = useStaffNameMap();
  const scrollRef = useRef<HTMLDivElement>(null);

  // `autoHeight`: the body sizes to content, capped by a max-height (px wins over
  // class), so short tables leave no trailing whitespace and tall ones scroll.
  const rootClass = autoHeight
    ? 'flex min-w-0 w-full bg-white relative'
    : 'flex h-full min-w-0 flex-1 bg-white relative';
  const columnClass = autoHeight
    ? 'flex flex-col w-full min-w-0'
    : 'flex-1 flex flex-col overflow-hidden';
  const xScroll = noHorizontalScroll ? 'overflow-x-hidden' : 'overflow-x-auto';
  const bodyScrollClass = autoHeight
    ? `${xScroll} overflow-y-auto no-scrollbar w-full ${maxBodyHeightPx == null ? maxBodyHeightClass ?? '' : ''}`
    : `flex-1 ${xScroll} overflow-y-auto no-scrollbar w-full`;
  const bodyScrollStyle =
    autoHeight && maxBodyHeightPx != null ? { maxHeight: maxBodyHeightPx } : undefined;
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

  if (loading) {
    return (
      <div className={autoHeight ? 'flex flex-col bg-gray-50' : 'flex-1 flex flex-col bg-gray-50 overflow-hidden'}>
        {hideHeader ? null : bannerTitle ? (
          <QueueTableBanner
            title={bannerTitle}
            subtitle={bannerSubtitle}
            compact={bannerCompact}
          />
        ) : (
          <div className="h-10 bg-white border-b border-gray-100 flex items-center px-4">
            <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
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
          <QueueTableBanner
            title={bannerTitle}
            subtitle={bannerSubtitle}
            compact={bannerCompact}
            isRefreshing={isRefreshing}
          />
        ) : (
          <WeekHeader
            count={totalCount}
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

        <div ref={scrollRef} className={bodyScrollClass} style={bodyScrollStyle}>
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
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-gray-500 font-semibold italic opacity-20">{emptyMessage}</p>
                  {showWeekControls && weekOffset > 0 && onResetWeek ? (
                    <button
                      type="button"
                      onClick={onResetWeek}
                      className={`mt-4 px-6 py-2 bg-gray-900 text-white ${sectionLabel} rounded-xl hover:bg-gray-800 transition-all active:scale-95`}
                    >
                      Go to Current Week
                    </button>
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
                  dateHeaderVariant={dateHeaderVariant}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
