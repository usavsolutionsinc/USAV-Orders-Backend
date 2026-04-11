'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { MobileDateGroupHeader } from '@/components/mobile/MobileDateGroupHeader';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import {
  FnskuChip,
  OrderIdChip,
  OrderIdChipPlaceholder,
  TrackingOrSkuScanChip,
  SerialChip,
  PlatformChip,
  getLast4,
  getLast6Serial,
} from '@/components/ui/CopyChip';
import WeekHeader from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { fetchDashboardPackedRecords, fetchDashboardShippedData } from '@/lib/dashboard-table-data';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails, getOpenShippedDetailsPayload } from '@/utils/events';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import { getSourceDotType, isSkuSourceRecord, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import { normalizeShippedSearchField, type ShippedSearchField } from '@/lib/shipped-search';
import {
  readShippedFilterPreference,
  writeShippedFilterPreference,
} from '@/utils/dashboard-preferences';

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

function hasLinkedOrder(record: { order_row_id?: number | null; order_id?: string | null }): boolean {
  if (record.order_row_id != null) return true;
  return String(record.order_id || '').trim().length > 0;
}
import { getStaffName } from '@/utils/staff';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { getStaffTextColor } from '@/design-system/components/StaffBadge';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { isEmptyDisplayValue } from '@/utils/empty-display-value';

export interface DashboardShippedTableProps {
  packedBy?: number;
  testedBy?: number;
  /** Mobile tech/packer: one scroll column, no extra shell wrappers; WeekHeader matches other mobile week tables. */
  embedded?: boolean;
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
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
  const [searchFallbackRecords, setSearchFallbackRecords] = useState<PackerRecord[]>([]);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const [isResolvingSearch, setIsResolvingSearch] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resolvedSearchKeyRef = useRef('');

  const search = searchParams.get('search') || '';
  const shippedSearchField = normalizeShippedSearchField(searchParams.get('shippedSearchField'));
  const shippedFilterParam = searchParams.get('shippedFilter');
  const shippedFilter = useMemo(() => {
    if (shippedFilterParam === 'orders' || shippedFilterParam === 'sku' || shippedFilterParam === 'fba') {
      return shippedFilterParam;
    }
    if (shippedFilterParam === 'all') return 'all';
    return readShippedFilterPreference() ?? 'all';
  }, [shippedFilterParam]);
  const weekOffsetParam = searchParams.get('shippedWeekOffset');
  const weekOffset = useMemo(() => {
    if (weekOffsetParam != null) {
      return Math.max(0, Number.parseInt(weekOffsetParam || '0', 10) || 0);
    }
    return 0;
  }, [weekOffsetParam]);
  const weekRange = getWeekRangeForOffset(weekOffset);
  const formatDate = useCallback((dateStr: string) => formatDateWithOrdinal(dateStr), []);

  const queryKey = ['dashboard-table', 'shipped', { weekStart: weekRange.startStr, weekEnd: weekRange.endStr, packedBy, testedBy, shippedFilter }] as const;

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchDashboardPackedRecords({
        packedBy,
        testedBy,
        weekStart: weekRange.startStr,
        weekEnd: weekRange.endStr,
        shippedFilter,
      }),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    writeShippedFilterPreference(
      shippedFilter === 'orders' || shippedFilter === 'sku' || shippedFilter === 'fba' ? shippedFilter : 'all'
    );
  }, [shippedFilter]);

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
      const nextId = Number(payload?.order?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    };
    const handleClose = () => setSelectedDetailId(null);

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
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath, { scroll: false });
  };

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    resolvedSearchKeyRef.current = '';
    setSearchFallbackRecords([]);
    setIsResolvingSearch(false);
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath, { scroll: false });
  };

  const rawRecords = useMemo(() => query.data || [], [query.data]);
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
    tracking_numbers: record.tracking_numbers || [],
    tracking_number_rows: (record as any).tracking_number_rows || [],
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
    row_source: ((record as any).row_source || 'order') as ShippedOrder['row_source'],
    exception_reason: (record as any).exception_reason || null,
    exception_status: (record as any).exception_status || null,
    fnsku: record.fnsku || null,
    fnsku_log_id: record.fnsku_log_id ?? null,
  } as ShippedOrder), []);

  const getDetailId = useCallback((record: PackerRecord) => Number(record.order_row_id || record.id), []);

  const toSearchResultRecord = useCallback((record: ShippedOrder): PackerRecord => ({
    id: Number(record.id),
    created_at: record.created_at || record.packed_at || null,
    scan_ref: record.shipping_tracking_number || '',
    shipping_tracking_number: record.shipping_tracking_number || '',
    tracking_numbers: Array.isArray((record as any).tracking_numbers) ? (record as any).tracking_numbers : [],
    tracking_number_rows: Array.isArray((record as any).tracking_number_rows) ? (record as any).tracking_number_rows : [],
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
    row_source: (record as any).row_source || 'order',
    exception_reason: (record as any).exception_reason || null,
    exception_status: (record as any).exception_status || null,
    fnsku: record.fnsku ?? null,
    fnsku_log_id: record.fnsku_log_id ?? null,
  } as PackerRecord), []);

  const dedupedRecords = useMemo(() => {
    const seen = new Map<string, PackerRecord>();
    [...rawRecords].sort((a, b) => a.id - b.id).forEach((record) => {
      const orderKey = String(record.order_id || '').trim();
      const key = orderKey || (record.shipping_tracking_number || record.scan_ref || String(record.id)).trim();
      seen.set(key, record);
    });
    return Array.from(seen.values());
  }, [rawRecords]);

  // Client-side guard — server already filters by shippedFilter, but this prevents
  // stale cached records from a prior filter mode appearing while the new fetch loads.
  const typeFilteredRecords = useMemo(() =>
    shippedFilter === 'fba'
      ? dedupedRecords.filter(isFbaPackerRecord)
      : shippedFilter === 'orders'
        ? dedupedRecords.filter((r) => !isFbaPackerRecord(r) && hasLinkedOrder(r))
        : shippedFilter === 'sku'
          ? dedupedRecords.filter(isSkuPackerRecord)
          : dedupedRecords.filter((r) => {
              // "all" = actually shipped: orders + FBA. SKU-only rows are prepacked (not shipped) — use SKU tab.
              if (isSkuPackerRecord(r)) return false;
              if (isFbaPackerRecord(r)) return true;
              return hasLinkedOrder(r);
            }),
    [dedupedRecords, shippedFilter],
  );

  const filteredRecords = useMemo(() =>
    normalizedSearch
      ? typeFilteredRecords.filter((record) => {
        const haystackByField: Record<ShippedSearchField, Array<unknown>> = {
          all: [
            record.product_title,
            record.order_id,
            record.shipping_tracking_number,
            record.scan_ref,
            record.sku,
            record.serial_number,
          ],
          order_id: [record.order_id],
          tracking: [record.shipping_tracking_number, record.scan_ref],
          product_title: [record.product_title],
          sku: [record.sku],
          serial_number: [record.serial_number],
        };
        const values = haystackByField[shippedSearchField]
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean);
        if (shippedSearchField === 'order_id') {
          return values.some((value) => value === normalizedSearch || value.startsWith(normalizedSearch));
        }
        return values.join(' ').includes(normalizedSearch);
      })
    : typeFilteredRecords,
    [normalizedSearch, shippedSearchField, typeFilteredRecords],
  );

  const records = useMemo(
    () => filteredRecords.length > 0 ? filteredRecords : searchFallbackRecords,
    [filteredRecords, searchFallbackRecords],
  );

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
      shippedFilter,
      shippedSearchField,
    ].join('|');

    if (resolvedSearchKeyRef.current === searchKey) {
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
          shippedFilter,
          searchField: shippedSearchField,
        });
        if (cancelled) return;

        const normalizedResults = shippedResults.map(toSearchResultRecord);
        resolvedSearchKeyRef.current = searchKey;
        setSearchFallbackRecords(normalizedResults);
      } catch {
        if (!cancelled) {
          resolvedSearchKeyRef.current = searchKey;
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
    shippedSearchField,
    shippedFilter,
    testedBy,
    toSearchResultRecord,
  ]);

  const handleRowClick = useCallback((record: PackerRecord) => {
    const detail = toDetailRecord(record);
    const detailId = getDetailId(record);

    if (selectedDetailId !== null && detailId === selectedDetailId) {
      dispatchCloseShippedDetails();
      setSelectedDetailId(null);
      return;
    }

    dispatchOpenShippedDetails(detail, 'shipped');
    setSelectedDetailId(detailId);
  }, [getDetailId, selectedDetailId, toDetailRecord]);

  const groupedRecords = useMemo(() => {
    const groups: Record<string, PackerRecord[]> = {};
    records.forEach((record) => {
      const dateSource = record.created_at;
      if (!dateSource || dateSource === '1') return;

      let date = '';
      try {
        date = toPSTDateKey(String(dateSource)) || 'Unknown';
      } catch {
        date = 'Unknown';
      }

      if (!groups[date]) groups[date] = [];
      groups[date].push(record);
    });
    return groups;
  }, [records]);

  const sortedGroupedEntries = useMemo(
    () => Object.entries(groupedRecords).sort((a, b) => b[0].localeCompare(a[0])),
    [groupedRecords]
  );

  const orderedRecords = sortedGroupedEntries.flatMap(([, dayRecords]) =>
      [...dayRecords].sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        return timeB - timeA;
      })
    );

  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (selectedDetailId === null || orderedRecords.length === 0) return;

      const currentIndex = orderedRecords.findIndex((record) => getDetailId(record) === selectedDetailId);
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;

      const nextDetail = toDetailRecord(nextRecord);
      dispatchOpenShippedDetails(nextDetail, 'shipped');
      setSelectedDetailId(getDetailId(nextRecord));
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigate as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigate as any);
    };
  }, [getDetailId, orderedRecords, selectedDetailId, toDetailRecord]);

  const scrollRafRef = useRef(0);
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
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

      if (activeDate) {
        setStickyDate(formatDate(activeDate));
        setCurrentCount(activeCount);
      } else if (sortedGroupedEntries.length > 0) {
        setStickyDate(formatDate(sortedGroupedEntries[0][0]));
        setCurrentCount(sortedGroupedEntries[0][1].length);
      }
    });
  }, [formatDate, sortedGroupedEntries]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
    if (sortedGroupedEntries.length > 0) {
      setStickyDate(formatDate(sortedGroupedEntries[0][0]));
      setCurrentCount(sortedGroupedEntries[0][1].length);
      return;
    }

    setStickyDate(
      weekOffset > 0
        ? `${formatDate(weekRange.startStr)} - ${formatDate(weekRange.endStr)}`
        : formatDate(getCurrentPSTDateKey())
    );
    setCurrentCount(0);
  }, [formatDate, sortedGroupedEntries, weekOffset, weekRange.endStr, weekRange.startStr]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      window.setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const totalCount = Object.values(groupedRecords).reduce((sum, dayRecords) => sum + dayRecords.length, 0);
  const fallbackDate =
    weekOffset > 0
      ? `${formatDate(weekRange.startStr)} - ${formatDate(weekRange.endStr)}`
      : formatDate(getCurrentPSTDateKey());
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

  if (query.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading shipped records...</p>
        </div>
      </div>
    );
  }

  const shippedTableInner = (
    <>
          {bannerTitle ? (
            <div className={mainStickyHeaderClass}>
              <div className={mainStickyHeaderRowClass}>
                <div>
                  <p className={`${sectionLabel} text-blue-700`}>{bannerTitle}</p>
                  {bannerSubtitle ? (
                    <p className={`mt-0.5 ${fieldLabel}`}>{bannerSubtitle}</p>
                  ) : null}
                </div>
                <div className="min-w-[18px] flex items-center justify-end">
                  {((query.isFetching && !query.isLoading) || isResolvingSearch) ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
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
              onPrevWeek={() => setWeekOffsetInUrl(weekOffset + 1)}
              onNextWeek={() => setWeekOffsetInUrl(Math.max(0, weekOffset - 1))}
            />
          )}

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-auto no-scrollbar w-full">
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
                    <p className="text-gray-500 font-semibold italic opacity-20">No shipped records for this week</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col w-full">
                {sortedGroupedEntries.map(([date, dayRecords]) => {
                    const sortedRecords = [...dayRecords].sort((a, b) => {
                      const timeA = new Date(a.created_at || 0).getTime();
                      const timeB = new Date(b.created_at || 0).getTime();
                      return timeB - timeA;
                    });

                    return (
                      <div key={date} className="flex flex-col">
                        {embedded ? (
                          <MobileDateGroupHeader
                            date={date}
                            total={dayRecords.length}
                          />
                        ) : (
                          <DateGroupHeader
                            date={date}
                            total={dayRecords.length}
                          />
                        )}
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
                          const techStaffId = (record as any).tested_by ?? (record as any).tester_id ?? null;
                          const packerStaffId = (record as any).packed_by ?? (record as any).packer_id ?? null;
                          const techColorClass = getStaffTextColor(techStaffId);
                          const packerColorClass = getStaffTextColor(packerStaffId);
                          const serialValue = String(record.serial_number || '').trim();
                          const serialDisplay =
                            isEmptyDisplayValue(serialValue) || serialValue === '---'
                              ? 'SERIAL'
                              : getLast6Serial(serialValue);
                          const platformLabel = getOrderPlatformLabel(record.order_id || '', record.account_source);
                          const orderIsFbaMeta = isFbaOrder(record.order_id, record.account_source);
                          const platformColor = platformLabel ? getOrderPlatformColor(platformLabel) : '';
                          const scanForSku =
                            String((record as { scan_ref?: string | null }).scan_ref || '').trim() ||
                            String(record.shipping_tracking_number || '').trim();
                          const productPageUrl = getExternalUrlByItemNumber(
                            String(record.item_number || '').trim() || skuScanPrefixBeforeColon(scanForSku),
                          );
                          const hideOrderIdChip = isSkuSourceRecord({
                            orderId: record.order_id,
                            accountSource: record.account_source,
                            trackingType: record.tracking_type,
                            scanRef:
                              String((record as { scan_ref?: string | null }).scan_ref || '').trim() ||
                              record.shipping_tracking_number ||
                              null,
                          });

                          return (
                            <div
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
                              aria-pressed={selectedDetailId === detail.id}
                              aria-label={`Open shipped order ${record.order_id || record.id}`}
                              data-order-row-id={String(record.order_row_id || record.id)}
                              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-colors border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                                selectedDetailId === detail.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
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
                                  <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest truncate min-w-0 flex-1 pl-4">
                                    <span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : undefined}>
                                      {parseInt(String(record.quantity || '1'), 10) || 1}
                                    </span>
                                    {' • '}
                                    {displayValues.condition || 'No Condition'}
                                    {' • '}
                                    {displayValues.sku || 'No SKU'}
                                    {' • '}
                                    <span className={techColorClass}>{techDisplay}</span>
                                    {' • '}
                                    <span className={packerColorClass}>{packerDisplay}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-0.5 pr-2">
                                {rowIsFba ? (
                                  <>
                                    <FnskuChip value={fnskuValue} />
                                    <SerialChip value={serialValue} display={serialDisplay} />
                                  </>
                                ) : (
                                  <>
                                    {platformLabel && !orderIsFbaMeta ? (
                                      <PlatformChip
                                        label={platformLabel}
                                        underlineClass={getOrderPlatformBorderColor(platformLabel)}
                                        iconClass={productPageUrl ? platformColor : 'text-gray-500'}
                                        onClick={() => {
                                          if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
                                        }}
                                      />
                                    ) : null}
                                    {!hideOrderIdChip ? (
                                      <OrderIdChip
                                        value={record.order_id || ''}
                                        display={getLast4(record.order_id)}
                                      />
                                    ) : (
                                      <OrderIdChipPlaceholder />
                                    )}
                                    <TrackingOrSkuScanChip value={record.shipping_tracking_number || ''} />
                                    <SerialChip
                                      value={serialValue}
                                      display={serialDisplay}
                                    />
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
        {shippedTableInner}
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 bg-white relative">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {shippedTableInner}
        </div>
      </div>
    </div>
  );
}
