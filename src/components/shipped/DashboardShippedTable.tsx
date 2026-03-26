'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { FnskuChip, OrderIdChip, TrackingChip, SerialChip, getLast4, getLast6Serial } from '@/components/ui/CopyChip';
import WeekHeader from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { fetchDashboardPackedRecords, fetchDashboardShippedData } from '@/lib/dashboard-table-data';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails, getOpenShippedDetailsPayload } from '@/utils/events';
import { DateGroupHeader } from './DateGroupHeader';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getSourceDotType, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';

// FBA records are identified by scan_ref matching Amazon's FBA shipment ID format
// (FBAxxxxxxxx) or by tracking_type being 'FBA' / 'FNSKU'.
const FBA_SHIPMENT_ID_RE = /^FBA[0-9A-Z]{8,}$/i;
function isFbaPackerRecord(record: { scan_ref?: string | null; tracking_type?: string | null }): boolean {
  const scanRef = String(record.scan_ref || '').trim();
  const ttype = String(record.tracking_type || '').toUpperCase();
  return FBA_SHIPMENT_ID_RE.test(scanRef) || ttype === 'FBA' || ttype === 'FNSKU';
}
// SKU records are identified by tracking_type === 'SKU' (set by packer_logs.tracking_type)
// or by scan_ref containing ':' (the "SKU_VALUE:QUANTITY" format used at the pack station).
function isSkuPackerRecord(record: { scan_ref?: string | null; tracking_type?: string | null }): boolean {
  const ttype = String(record.tracking_type || '').toUpperCase();
  if (ttype === 'SKU') return true;
  const scanRef = String(record.scan_ref || '').trim();
  return scanRef.includes(':');
}
import { getStaffName } from '@/utils/staff';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';

export interface DashboardShippedTableProps {
  packedBy?: number;
  testedBy?: number;
  bannerTitle?: DashboardSearchSectionProps['bannerTitle'];
  bannerSubtitle?: DashboardSearchSectionProps['bannerSubtitle'];
  searchEmptyTitle?: DashboardSearchSectionProps['searchEmptyTitle'];
  searchResultLabel?: DashboardSearchSectionProps['searchResultLabel'];
  clearSearchLabel?: DashboardSearchSectionProps['clearSearchLabel'];
}

export function DashboardShippedTable({
  packedBy,
  testedBy,
  bannerTitle,
  bannerSubtitle,
  searchEmptyTitle = 'No shipped orders found',
  searchResultLabel = 'shipped orders',
  clearSearchLabel = 'Show All Shipped Orders',
}: DashboardShippedTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
  const [searchFallbackRecords, setSearchFallbackRecords] = useState<PackerRecord[]>([]);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const [isResolvingSearch, setIsResolvingSearch] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resolvedSearchKeyRef = useRef('');

  const search = searchParams.get('search') || '';
  const shippedFilterParam = searchParams.get('shippedFilter') || 'all';
  const weekOffset = Math.max(0, Number.parseInt(searchParams.get('shippedWeekOffset') || '0', 10) || 0);
  const weekRange = getWeekRangeForOffset(weekOffset);
  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

  const queryKey = ['dashboard-table', 'shipped', { weekStart: weekRange.startStr, weekEnd: weekRange.endStr, packedBy, testedBy, shippedFilter: shippedFilterParam }] as const;

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchDashboardPackedRecords({
        packedBy,
        testedBy,
        weekStart: weekRange.startStr,
        weekEnd: weekRange.endStr,
        shippedFilter: shippedFilterParam,
      }),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
    };

    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
    };
  }, [queryClient]);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<ShippedOrder>) => {
      const payload = getOpenShippedDetailsPayload(e.detail);
      if (payload?.order) setSelectedShipped(payload.order);
    };
    const handleClose = () => setSelectedShipped(null);

    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);

    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, []);

  const setWeekOffsetInUrl = (nextOffset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextOffset <= 0) params.delete('shippedWeekOffset');
    else params.set('shippedWeekOffset', String(nextOffset));
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  };

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  };

  const rawRecords = query.data || [];
  const normalizedSearch = search.trim().toLowerCase();

  const toDetailRecord = useCallback((record: PackerRecord): ShippedOrder => ({
    id: record.order_row_id || record.id,
    deadline_at: record.deadline_at || null,
    ship_by_date: record.ship_by_date || null,
    order_id: record.order_id || '',
    product_title: record.product_title || '',
    quantity: record.quantity || '1',
    item_number: record.item_number || null,
    condition: record.condition || '',
    shipment_id: record.shipment_id ?? null,
    shipping_tracking_number: record.shipping_tracking_number || '',
    serial_number: record.serial_number || '',
    sku: record.sku || '',
    tester_id: record.tester_id ?? null,
    tested_by: record.tested_by ?? null,
    test_date_time: record.test_date_time || null,
    packer_id: record.packed_by ?? null,
    packed_by: record.packed_by ?? null,
    packed_at: record.created_at || null,
    packer_photos_url: record.packer_photos_url || [],
    tracking_type: record.tracking_type || null,
    account_source: record.account_source || null,
    notes: record.notes || '',
    status_history: record.status_history || [],
    created_at: record.created_at || null,
    tested_by_name: record.tested_by_name || null,
    packed_by_name: record.packed_by_name || null,
    tester_name: record.tester_name || null,
    packer_log_id: record.packer_log_id ?? null,
    station_activity_log_id: record.id,
  } as ShippedOrder), []);

  const toSearchResultRecord = useCallback((record: ShippedOrder): PackerRecord => ({
    id: Number(record.id),
    created_at: record.created_at || record.packed_at || null,
    scan_ref: record.shipping_tracking_number || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    packed_by: record.packer_id ?? record.packed_by ?? null,
    packed_by_name: record.packed_by_name || null,
    tracking_type: record.tracking_type || null,
    packer_photos_url: record.packer_photos_url || [],
    order_row_id: Number(record.id),
    shipment_id: record.shipment_id ?? null,
    order_id: record.order_id || '',
    account_source: record.account_source || null,
    product_title: record.product_title || '',
    quantity: record.quantity || '1',
    item_number: record.item_number || null,
    condition: record.condition || '',
    sku: record.sku || '',
    notes: record.notes || '',
    status_history: record.status_history || [],
    serial_number: record.serial_number || '',
    tested_by: record.tested_by ?? null,
    tester_id: record.tester_id ?? null,
    test_date_time: record.test_date_time || null,
    tested_by_name: record.tested_by_name || null,
    tester_name: record.tester_name || null,
  } as PackerRecord), []);

  const seenTracking = new Map<string, PackerRecord>();
  [...rawRecords].sort((a, b) => a.id - b.id).forEach((record) => {
    const key = (record.shipping_tracking_number || record.scan_ref || String(record.id)).trim();
    seenTracking.set(key, record);
  });
  const dedupedRecords = Array.from(seenTracking.values());
  // Client-side guard — server already filters by shippedFilter, but this prevents
  // stale cached records from a prior filter mode appearing while the new fetch loads.
  const typeFilteredRecords =
    shippedFilterParam === 'fba'
      ? dedupedRecords.filter(isFbaPackerRecord)
      : shippedFilterParam === 'orders'
        ? dedupedRecords.filter((r) => !isFbaPackerRecord(r))
        : shippedFilterParam === 'sku'
          ? dedupedRecords.filter(isSkuPackerRecord)
          : dedupedRecords; // 'all' — show everything
  const filteredRecords = normalizedSearch
    ? typeFilteredRecords.filter((record) => {
        const haystack = [
          record.product_title,
          record.order_id,
          record.shipping_tracking_number,
          record.scan_ref,
          record.sku,
          record.condition,
          record.account_source,
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ');
        return haystack.includes(normalizedSearch);
      })
    : typeFilteredRecords;

  const records = filteredRecords.length > 0 ? filteredRecords : searchFallbackRecords;

  useEffect(() => {
    if (!normalizedSearch) {
      resolvedSearchKeyRef.current = '';
      setSearchFallbackRecords([]);
      setIsResolvingSearch(false);
      return;
    }

    if (filteredRecords.length > 0 || query.isLoading || query.isFetching) {
      return;
    }

    const searchKey = [
      normalizedSearch,
      packedBy ?? '',
      testedBy ?? '',
      shippedFilterParam,
    ].join('|');

    if (resolvedSearchKeyRef.current === searchKey && searchFallbackRecords.length > 0) {
      return;
    }

    let cancelled = false;

    const resolveSearch = async () => {
      setIsResolvingSearch(true);
      try {
        const shippedResults = await fetchDashboardShippedData({
          searchQuery: search,
          packedBy,
          testedBy,
          shippedFilter: shippedFilterParam,
        });
        if (cancelled) return;

        const normalizedResults = shippedResults.map(toSearchResultRecord);
        resolvedSearchKeyRef.current = searchKey;
        setSearchFallbackRecords(normalizedResults);
      } catch {
        if (!cancelled) {
          setSearchFallbackRecords([]);
        }
      } finally {
        if (!cancelled) setIsResolvingSearch(false);
      }
    };

    void resolveSearch();

    return () => {
      cancelled = true;
    };
  }, [
    filteredRecords.length,
    normalizedSearch,
    packedBy,
    query.isFetching,
    query.isLoading,
    search,
    searchFallbackRecords.length,
    testedBy,
    toSearchResultRecord,
  ]);

  const handleRowClick = useCallback((record: PackerRecord) => {
    const detail = toDetailRecord(record);
    if (selectedShipped && Number(selectedShipped.id) === Number(detail.id)) {
      dispatchCloseShippedDetails();
      setSelectedShipped(null);
      return;
    }

    dispatchOpenShippedDetails(detail, 'shipped');
    setSelectedShipped(detail);
  }, [selectedShipped, toDetailRecord]);

  const groupedRecords: Record<string, PackerRecord[]> = {};
  records.forEach((record) => {
    const dateSource = record.created_at;
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

  const orderedRecords = Object.entries(groupedRecords)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .flatMap(([, dayRecords]) =>
      [...dayRecords].sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        return timeB - timeA;
      })
    );

  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (!selectedShipped || orderedRecords.length === 0) return;

      const currentIndex = orderedRecords.findIndex((record) => Number(record.order_row_id || record.id) === Number(selectedShipped.id));
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;

      const nextDetail = toDetailRecord(nextRecord);
      dispatchOpenShippedDetails(nextDetail, 'shipped');
      setSelectedShipped(nextDetail);
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigate as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigate as any);
    };
  }, [orderedRecords, selectedShipped, toDetailRecord]);

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
  }, [handleScroll, records]);

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

  if (query.isLoading || isResolvingSearch) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">
            {isResolvingSearch ? 'Resolving order search...' : 'Loading shipped records...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
          {bannerTitle ? (
            <div className={mainStickyHeaderClass}>
              <div className={mainStickyHeaderRowClass}>
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-700">{bannerTitle}</p>
                  {bannerSubtitle ? (
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{bannerSubtitle}</p>
                  ) : null}
                </div>
                <div className="min-w-[18px] flex items-center justify-end">
                  {query.isFetching && !query.isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> : null}
                </div>
              </div>
            </div>
          ) : (
            <WeekHeader
              stickyDate={stickyDate}
              fallbackDate={fallbackDate}
              count={currentCount || totalCount}
              countClassName="text-blue-700"
              weekRange={weekRange}
              weekOffset={weekOffset}
              onPrevWeek={() => setWeekOffsetInUrl(weekOffset + 1)}
              onNextWeek={() => setWeekOffsetInUrl(Math.max(0, weekOffset - 1))}
              formatDate={formatDate}
              showWeekControls
              highContrast
            />
          )}

          <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
            {Object.keys(groupedRecords).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-40 text-center">
                {search ? (
                  <OrderSearchEmptyState
                    query={search}
                    title={searchEmptyTitle}
                    resultLabel={searchResultLabel}
                    clearLabel={clearSearchLabel}
                    onClear={clearSearch}
                  />
                ) : (
                  <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                    <p className="text-gray-500 font-medium italic opacity-20">No shipped records for this week</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col w-full">
                {Object.entries(groupedRecords)
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([date, dayRecords]) => {
                    const sortedRecords = [...dayRecords].sort((a, b) => {
                      const timeA = new Date(a.created_at || 0).getTime();
                      const timeB = new Date(b.created_at || 0).getTime();
                      return timeB - timeA;
                    });

                    return (
                      <div key={date} className="flex flex-col">
                        <DateGroupHeader date={date} total={dayRecords.length} formatDate={formatDate} />
                        {sortedRecords.map((record, index) => {
                          const detail = toDetailRecord(record);
                          const displayValues = getOrderDisplayValues({
                            sku: record.sku,
                            condition: record.condition,
                            trackingNumber: record.shipping_tracking_number,
                          });
                          const dotType = getSourceDotType({
                            orderId: record.order_id,
                            accountSource: record.account_source,
                            trackingType: record.tracking_type,
                            scanRef: record.scan_ref,
                          });
                          const rowIsFba = isFbaPackerRecord(record);
                          const fnskuValue = String(record.scan_ref || '').trim();
                          const techName = String(
                            (record as any).tested_by_name
                            || (record as any).tester_name
                            || getStaffName((record as any).tested_by ?? (record as any).tester_id ?? null)
                          ).trim();
                          const packerName = String(
                            (record as any).packed_by_name
                            || (record as any).packer_name
                            || getStaffName((record as any).packed_by ?? (record as any).packer_id ?? null)
                          ).trim();
                          const techDisplay = normalizePersonName(techName);
                          const packerDisplay = normalizePersonName(packerName);
                          const serialValue = String(record.serial_number || '').trim();
                          const serialDisplay =
                            isEmptyDisplayValue(serialValue) || serialValue === '---'
                              ? 'SERIAL'
                              : getLast6Serial(serialValue);

                          return (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              key={record.id}
                              onClick={() => handleRowClick(record)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  handleRowClick(record);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-pressed={selectedShipped?.id === detail.id}
                              aria-label={`Open shipped order ${record.order_id || record.id}`}
                              data-order-row-id={String(record.order_row_id || record.id)}
                              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                                selectedShipped?.id === detail.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                              }`}
                            >
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_DOT_BG[dotType]}`}
                                    title={SOURCE_DOT_LABEL[dotType]}
                                  />
                                  <div className="text-[11px] font-bold text-gray-900 truncate">
                                    {record.product_title || 'Unknown Product'}
                                  </div>
                                </div>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest truncate min-w-0 flex-1 pl-4">
                                    <span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : undefined}>
                                      {parseInt(String(record.quantity || '1'), 10) || 1}
                                    </span>
                                    {' • '}
                                    {displayValues.condition || 'No Condition'}
                                    {' • '}
                                    {displayValues.sku || 'No SKU'}
                                    {' • '}
                                    {techDisplay}
                                    {' • '}
                                    {packerDisplay}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                {rowIsFba ? (
                                  <>
                                    <FnskuChip value={fnskuValue} />
                                    <SerialChip value={serialValue} display={serialDisplay} />
                                  </>
                                ) : (
                                  <>
                                    <OrderIdChip
                                      value={record.order_id || ''}
                                      display={getLast4(record.order_id)}
                                    />
                                    <TrackingChip
                                      value={record.shipping_tracking_number || ''}
                                      display={getLast4(record.shipping_tracking_number)}
                                    />
                                    <SerialChip
                                      value={serialValue}
                                      display={serialDisplay}
                                    />
                                  </>
                                )}
                              </div>
                            </motion.div>
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
    </div>
  );
}
