'use client';

import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, SkeletonList } from '@/design-system';
import { Loader2 } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { OrderIdChip, OrderIdChipPlaceholder, TrackingOrSkuScanChip, PlatformChip, getLast4 } from '@/components/ui/CopyChip';
import { PasteTrackingButton } from '@/components/ui/PasteTrackingButton';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { getStaffTextColor } from '@/design-system/components/StaffBadge';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import WeekHeader from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey, getDaysLateNullable, getDaysLateTone } from '@/utils/date';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { getOpenShippedDetailsPayload } from '@/utils/events';
import { isSkuSourceRecord } from '@/utils/source-dot';


function normalizePersonName(value: unknown): string {
  const text = String(value ?? '')
    .replace(/^tech:\s*/i, '')
    .replace(/^packer:\s*/i, '')
    .trim();
  if (!text) return '---';
  if (/^(not specified|n\/a|null|undefined)$/i.test(text)) return '---';
  if (/^staff\s*#\d+$/i.test(text)) return '---';
  return text;
}

interface WeekRange {
  startStr: string;
  endStr: string;
}

type QueueRowRecord = ShippedOrder & Record<string, unknown>;

/** Memoized row: when React Query merges one updated order, unrelated rows skip re-render. */
const OrdersQueueTableRow = memo(function OrdersQueueTableRow({
  record,
  isSelected,
  useAlternateStripe,
  testerDisplay,
  packerDisplay,
  testerId,
  packerId,
  hasTechScan,
  hasOutOfStock,
  outOfStockValue,
  daysLate,
  onRowClick,
}: {
  record: QueueRowRecord;
  isSelected: boolean;
  useAlternateStripe: boolean;
  testerDisplay: string;
  packerDisplay: string;
  testerId: number | null;
  packerId: number | null;
  hasTechScan: boolean;
  hasOutOfStock: boolean;
  outOfStockValue: string;
  daysLate: number | null;
  onRowClick: (record: ShippedOrder) => void;
}) {
  const testerColorClass = getStaffTextColor(testerId);
  const packerColorClass = getStaffTextColor(packerId);
  const qty = parseInt(String(record.quantity || '1'), 10) || 1;
  const qtyClass = qty > 1 ? 'text-yellow-600' : 'text-gray-500';
  const trackingRaw =
    (record.tracking_number as string | undefined) ||
    record.shipping_tracking_number ||
    '';
  const scanRefFromRecord = (record as QueueRowRecord & { scan_ref?: unknown }).scan_ref;
  const scanRefForSku =
    (typeof scanRefFromRecord === 'string' && scanRefFromRecord ? scanRefFromRecord : null) ?? trackingRaw;
  const hideOrderIdChip = isSkuSourceRecord({
    orderId: record.order_id,
    accountSource: record.account_source,
    trackingType: record.tracking_type,
    scanRef: scanRefForSku,
  });
  const platformLabel = getOrderPlatformLabel(record.order_id || '', record.account_source);
  const isFba = isFbaOrder(record.order_id, record.account_source);
  const platformColor = platformLabel ? getOrderPlatformColor(platformLabel) : '';
  const productPageUrl = getExternalUrlByItemNumber(
    String(record.item_number || '').trim() || skuScanPrefixBeforeColon(trackingRaw),
  );

  return (
    <motion.div
      {...framerPresence.tableRow}
      transition={framerTransition.tableRowMount}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.998 }}
      onClick={() => onRowClick(record)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onRowClick(record);
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Open order ${record.order_id || record.id}`}
      data-order-row-id={String(record.id)}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-all border-b border-gray-300 cursor-pointer hover:bg-blue-50/50 ${
        isSelected ? 'bg-blue-50/80' : useAlternateStripe ? 'bg-white' : 'bg-gray-50/10'
      }`}
    >
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {hasTechScan ? (
            <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Scanned by tech" />
          ) : hasOutOfStock ? (
            <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="Out of stock" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-yellow-400 shrink-0" title="Pending order" />
          )}
          <div className="text-[12px] font-bold text-gray-900 truncate">
            {record.product_title || 'Unknown Product'}
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest truncate min-w-0 flex-1">
            <span className={qtyClass}>{qty}</span>
            {' • '}
            <span className={String(record.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : undefined}>
              {record.condition || 'No Condition'}
            </span>
            {' • '}
            <span className={testerColorClass}>{testerDisplay}</span>
            {' • '}
            <span className={packerColorClass}>{packerDisplay}</span>
            {daysLate !== null ? (
              <>
                {' • '}
                <span className={getDaysLateTone(daysLate)}>{daysLate}</span>
              </>
            ) : null}
            {hasOutOfStock ? (
              <>
                {' • '}
                <span className="text-red-600">{outOfStockValue}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {platformLabel && !isFba ? (
          <PlatformChip
            label={platformLabel}
            underlineClass={platformLabel ? getOrderPlatformBorderColor(platformLabel) : ''}
            iconClass={productPageUrl ? platformColor : 'text-gray-500'}
            onClick={() => {
              if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
            }}
          />
        ) : null}
        {!hideOrderIdChip ? (
          <OrderIdChip value={record.order_id || ''} display={getLast4(record.order_id)} />
        ) : (
          <OrderIdChipPlaceholder />
        )}
        {trackingRaw
          ? <TrackingOrSkuScanChip value={trackingRaw} />
          : <PasteTrackingButton orderId={Number(record.id)} />
        }
      </div>
    </motion.div>
  );
}, (prev, next) => {
  if (prev.record.id !== next.record.id) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.useAlternateStripe !== next.useAlternateStripe) return false;
  if (prev.testerDisplay !== next.testerDisplay) return false;
  if (prev.packerDisplay !== next.packerDisplay) return false;
  if (prev.testerId !== next.testerId) return false;
  if (prev.packerId !== next.packerId) return false;
  if (prev.hasTechScan !== next.hasTechScan) return false;
  if (prev.hasOutOfStock !== next.hasOutOfStock) return false;
  if (prev.outOfStockValue !== next.outOfStockValue) return false;
  if (prev.daysLate !== next.daysLate) return false;
  if (prev.record.deadline_at !== next.record.deadline_at) return false;
  if (prev.record.product_title !== next.record.product_title) return false;
  if (prev.record.condition !== next.record.condition) return false;
  if (prev.record.order_id !== next.record.order_id) return false;
  if (prev.record.quantity !== next.record.quantity) return false;
  if (prev.record.account_source !== next.record.account_source) return false;
  if (prev.record.tracking_type !== next.record.tracking_type) return false;
  if (prev.record.item_number !== next.record.item_number) return false;
  if (prev.record.sku !== next.record.sku) return false;
  const prevTr =
    (prev.record.tracking_number as string | undefined) || prev.record.shipping_tracking_number || '';
  const nextTr =
    (next.record.tracking_number as string | undefined) || next.record.shipping_tracking_number || '';
  if (prevTr !== nextTr) return false;
  if (prev.onRowClick !== next.onRowClick) return false;
  return true;
});

interface OrdersQueueTableProps {
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
  onOpenRecord?: (record: ShippedOrder) => void;
  onCloseRecord?: (record: ShippedOrder | null) => void;
  /** When true, display tester/packer from work_assignments (tester_id, packer_id) only */
  useWaForDisplay?: boolean;
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
  onOpenRecord,
  onCloseRecord,
  useWaForDisplay = false,
}: OrdersQueueTableProps) {
  const { getStaffName } = useStaffNameMap();
  const [selectedRecord, setSelectedRecord] = useState<ShippedOrder | null>(null);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);
  const isShippedByLatestStatus = (record: ShippedOrder): boolean => {
    const category = String(record.latest_status_category ?? '').trim().toUpperCase();
    const label = String(record.latest_status_label ?? '').toUpperCase();
    const description = String(record.latest_status_description ?? '').toUpperCase();
    if (!category) {
      return label.includes('MOVING THROUGH NETWORK') || description.includes('MOVING THROUGH NETWORK');
    }
    return category !== 'LABEL_CREATED' && category !== 'UNKNOWN';
  };
  const visibleRecords = records.filter((record) => !isShippedByLatestStatus(record));

  useEffect(() => {
    if (!selectedRecord) return;
    const nextSelected = visibleRecords.find((record) => Number(record.id) === Number(selectedRecord.id));
    if (nextSelected && nextSelected !== selectedRecord) {
      setSelectedRecord(nextSelected);
      return;
    }
    if (!nextSelected) {
      onCloseRecord?.(selectedRecord);
      setSelectedRecord(null);
    }
  }, [onCloseRecord, selectedRecord, visibleRecords]);

  const handleRowClick = useCallback((record: ShippedOrder) => {
    if (selectedRecord && Number(selectedRecord.id) === Number(record.id)) {
      onCloseRecord?.(selectedRecord);
      setSelectedRecord(null);
      return;
    }
    onOpenRecord?.(record);
    setSelectedRecord(record);
  }, [onCloseRecord, onOpenRecord, selectedRecord]);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<ShippedOrder>) => {
      const payload = getOpenShippedDetailsPayload(e.detail);
      if (payload?.order) setSelectedRecord(payload.order);
    };
    const handleClose = () => setSelectedRecord(null);
    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, []);

  const groupedRecords: Record<string, ShippedOrder[]> = {};
  visibleRecords.forEach((record) => {
    const dateSource = record.deadline_at || record.created_at;
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

  const displayedRecords = Object.entries(groupedRecords)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([_, dayRecords]) => {
      const sortedRecords = [...dayRecords].sort((a, b) => {
        const timeA = new Date(a.deadline_at || a.created_at || 0).getTime();
        const timeB = new Date(b.deadline_at || b.created_at || 0).getTime();
        return timeA - timeB;
      });
      return sortedRecords;
    });

  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (!selectedRecord || displayedRecords.length === 0) return;

      const currentIndex = displayedRecords.findIndex((record) => Number(record.id) === Number(selectedRecord.id));
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = displayedRecords[currentIndex + step];
      if (!nextRecord) return;

      onOpenRecord?.(nextRecord);
      setSelectedRecord(nextRecord);
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigate as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigate as any);
    };
  }, [displayedRecords, onOpenRecord, selectedRecord]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const headers = scrollRef.current.querySelectorAll('[data-day-header]');
    let activeDate = '';
    let activeCount = 0;

    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i] as HTMLElement;
      if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
        activeDate = header.getAttribute('data-date') || '';
        activeCount = parseInt(header.getAttribute('data-count') || '0', 10);
      } else {
        break;
      }
    }

    if (activeDate) setStickyDate(formatDate(activeDate));
    if (activeCount) setCurrentCount(activeCount);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      window.setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, visibleRecords]);

  const totalCount = Object.values(groupedRecords).reduce((sum, dayRecords) => sum + dayRecords.length, 0);
  const fallbackDate = formatDate(getCurrentPSTDateKey());
  const normalizePersonName = (value: unknown): string => {
    const text = String(value ?? '')
      .replace(/^tech:\s*/i, '')
      .replace(/^packer:\s*/i, '')
      .trim();
    if (!text) return '---';
    if (/^(not specified|n\/a|null|undefined)$/i.test(text)) return '---';
    if (/^staff\s*#\d+$/i.test(text)) return '---';
    return text;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        {bannerTitle ? (
          <div className={mainStickyHeaderClass}>
            <div className={mainStickyHeaderRowClass}>
              <div>
                <p className={`${sectionLabel} text-blue-700`}>{bannerTitle}</p>
                {bannerSubtitle ? (
                  <p className={`${fieldLabel} mt-0.5 text-gray-500`}>{bannerSubtitle}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-10 bg-white border-b border-gray-100 flex items-center px-4">
            <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <SkeletonList count={12} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        {bannerTitle ? (
          <div className={mainStickyHeaderClass}>
            <div className={mainStickyHeaderRowClass}>
              <div>
                <p className={`${sectionLabel} text-blue-700`}>{bannerTitle}</p>
                {bannerSubtitle ? (
                  <p className={`${fieldLabel} mt-0.5 text-gray-500`}>{bannerSubtitle}</p>
                ) : null}
              </div>
              <div className="min-w-[18px] flex items-center justify-end">
                {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
              </div>
            </div>
          </div>
        ) : (
          <WeekHeader
            stickyDate={stickyDate}
            fallbackDate={fallbackDate}
            count={currentCount || totalCount}
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

        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(groupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
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
              {Object.entries(groupedRecords)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([date, dayRecords]) => {
                  const sortedRecords = [...dayRecords].sort((a, b) => {
                    const timeA = new Date(a.deadline_at || a.created_at || 0).getTime();
                    const timeB = new Date(b.deadline_at || b.created_at || 0).getTime();
                    return timeA - timeB;
                  });

                  return (
                    <div key={date} className="flex flex-col">
                      <DateGroupHeader date={date} total={dayRecords.length} />
                      {sortedRecords.map((record, index) => {
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
                        const testerDisplay = normalizePersonName(testerName);
                        const packerDisplay = normalizePersonName(packerName);
                        const outOfStockValue = String(r.out_of_stock || '').trim();
                        const hasOutOfStock = outOfStockValue !== '';
                        const hasTechScan = Boolean(r.has_tech_scan);
                        const defaultDaysLate = getDaysLateNullable(r.deadline_at as string | null | undefined);

                        return (
                          <OrdersQueueTableRow
                            key={record.id}
                            record={r}
                            isSelected={selectedRecord?.id === record.id}
                            useAlternateStripe={index % 2 === 0}
                            testerDisplay={testerDisplay}
                            packerDisplay={packerDisplay}
                            testerId={useWaForDisplay ? (r.tester_id as number | null) : (r.tested_by as number | null) ?? (r.tester_id as number | null)}
                            packerId={useWaForDisplay ? (r.packer_id as number | null) : (r.packed_by as number | null) ?? (r.packer_id as number | null)}
                            hasTechScan={hasTechScan}
                            hasOutOfStock={hasOutOfStock}
                            outOfStockValue={outOfStockValue}
                            daysLate={defaultDaysLate}
                            onRowClick={handleRowClick}
                          />
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
