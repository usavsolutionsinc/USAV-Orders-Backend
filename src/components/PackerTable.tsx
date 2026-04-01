'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { Loader2, Search } from './Icons';
import { FnskuChip, OrderIdChip, TrackingChip, PlatformChip, getLast4 } from './ui/CopyChip';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor } from '@/utils/order-platform';
import { getExternalUrlByItemNumber } from '@/hooks/useExternalItemUrl';
import { OverlaySearchBar } from './ui/OverlaySearchBar';
import WeekHeader from './ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { getOrderDisplayValues } from '@/utils/order-display';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { getSourceDotType, SOURCE_DOT_BG, SOURCE_DOT_LABEL } from '@/utils/source-dot';
import { isFbaOrder } from '@/utils/order-platform';
import { usePackerLogs, PackerRecord } from '@/hooks/usePackerLogs';

interface PackerTableProps {
  packedBy: number;
}

/** FBA / FNSKU pack rows: each activity log is its own row (matches TechTable — no tracking-key merge). */
function isFbaPackerRecord(record: PackerRecord): boolean {
  return (
    isFbaOrder(record.order_id, record.account_source) ||
    String(record.tracking_type || '').toUpperCase() === 'FNSKU'
  );
}

function computeWeekRange(weekOffset: number) {
  const todayPst = getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday - weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  return {
    start: monday,
    end: friday,
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}

export function PackerTable({ packedBy }: PackerTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDetailId, setSelectedDetailId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState(String(searchParams.get('search') || ''));
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const counterColorClass = stationThemeColors[getStaffThemeById(packedBy)].text;
  const currentSearch = String(searchParams.get('search') || '');
  const searchOpen = searchParams.get('searchOpen') === '1';
  const showSearch = searchOpen || Boolean(currentSearch);

  // Compute week range before calling the hook so it feeds into the query key.
  const weekRange = computeWeekRange(weekOffset);
  const { data: records = [], isLoading, isFetching } = usePackerLogs(packedBy, { weekOffset, weekRange });
  const loading = isLoading && records.length === 0;
  const isRefreshing = isFetching && !isLoading;

  useEffect(() => {
    setSearchInput(currentSearch);
  }, [currentSearch]);

  useEffect(() => {
    const handleOpenDetails = (e: any) => {
      const nextId = Number(e?.detail?.id);
      setSelectedDetailId(Number.isFinite(nextId) ? nextId : null);
    };
    const handleCloseDetails = () => setSelectedDetailId(null);

    window.addEventListener('open-shipped-details', handleOpenDetails as any);
    window.addEventListener('close-shipped-details', handleCloseDetails as any);

    return () => {
      window.removeEventListener('open-shipped-details', handleOpenDetails as any);
      window.removeEventListener('close-shipped-details', handleCloseDetails as any);
    };
  }, []);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

  const toDetailRecord = (record: PackerRecord) => {
    return {
      id: record.id,
      ship_by_date: '',
      order_id: record.order_id || '',
      product_title: record.product_title || '',
      item_number: null,
      condition: record.condition || '',
      shipping_tracking_number: record.shipping_tracking_number || '',
      tracking_numbers: record.tracking_numbers || [],
      tracking_number_rows: record.tracking_number_rows || [],
      serial_number: '',
      sku: record.sku || '',
      tester_id: null,
      tested_by: null,
      test_date_time: null,
      packer_id: record.packed_by || null,
      packed_by: record.packed_by || null,
      packed_at: record.created_at || null,
      packer_photos_url: record.packer_photos_url || [],
      tracking_type: null,
      account_source: null,
      notes: '',
      status_history: [],
      is_shipped: undefined,
      created_at: record.created_at || null,
      quantity: record.quantity || '1',
      packer_log_id: record.packer_log_id ?? null,
      station_activity_log_id: record.id,
    };
  };

  const getDetailId = (record: PackerRecord) => Number(toDetailRecord(record).id);

  const openDetails = (record: PackerRecord) => {
    const detail = toDetailRecord(record);

    const detailId = getDetailId(record);
    if (selectedDetailId !== null && detailId === selectedDetailId) {
      dispatchCloseShippedDetails();
      setSelectedDetailId(null);
      return;
    }

    window.dispatchEvent(new CustomEvent('open-shipped-details', { detail }));
    setSelectedDetailId(detailId);
  };

  const formatHeaderDate = () => formatDate(getCurrentPSTDateKey());

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop } = scrollRef.current;
    const headers = scrollRef.current.querySelectorAll('[data-day-header]');
    let activeDate = '';
    let activeCount = 0;
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i] as HTMLElement;
      if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
        activeDate = header.getAttribute('data-date') || '';
        activeCount = parseInt(header.getAttribute('data-count') || '0');
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
      setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, records]);

  const updateSearch = (value: string, keepOpen = true) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(packedBy));
    if (value.trim()) nextParams.set('search', value.trim());
    else nextParams.delete('search');
    if (keepOpen) nextParams.set('searchOpen', '1');
    else nextParams.delete('searchOpen');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/packer?${nextSearch}` : '/packer');
  };

  const openSearch = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(packedBy));
    nextParams.set('searchOpen', '1');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/packer?${nextSearch}` : '/packer');
  };

  const clearSearch = () => {
    setSearchInput('');
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('staffId', String(packedBy));
    nextParams.delete('search');
    nextParams.delete('searchOpen');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/packer?${nextSearch}` : '/packer');
  };

  useEffect(() => {
    if (!showSearch) return;
    const timeoutId = window.setTimeout(() => {
      const normalizedCurrent = currentSearch.trim();
      const normalizedNext = searchInput.trim();
      if (normalizedCurrent === normalizedNext) return;
      updateSearch(searchInput, true);
    }, 180);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput, currentSearch, showSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showSearch) return;
    const timeoutId = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(timeoutId);
  }, [showSearch]);

  // Deduplicate: latest record per tracking key — except FBA/FNSKU rows (each scan stays visible).
  const seenTracking = new Map<string, PackerRecord>();
  [...records].sort((a, b) => a.id - b.id).forEach((record) => {
    if (isFbaPackerRecord(record)) {
      seenTracking.set(`fba:${record.id}`, record);
      return;
    }
    const key = (record.shipping_tracking_number || record.scan_ref || String(record.id)).trim();
    seenTracking.set(key, record);
  });
  const dedupedRecords = Array.from(seenTracking.values());
  const normalizedSearch = currentSearch.trim().toLowerCase();
  const visibleRecords = normalizedSearch
    ? dedupedRecords.filter((record) => {
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
    : dedupedRecords;

  // Group records by date
  const groupedRecords: { [key: string]: PackerRecord[] } = {};
  visibleRecords.forEach(record => {
    if (!record.created_at) return;
    let date = '';
    try {
      date = toPSTDateKey(record.created_at) || 'Unknown';
    } catch (e) {
      date = 'Unknown';
    }
    if (!groupedRecords[date]) groupedRecords[date] = [];
    groupedRecords[date].push(record);
  });

  const filteredGroupedRecords = Object.fromEntries(
    Object.entries(groupedRecords).filter(([date]) => date >= weekRange.startStr && date <= weekRange.endStr)
  );

  const orderedRecords = Object.entries(filteredGroupedRecords)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .flatMap(([, dateRecords]) =>
      [...dateRecords].sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        return timeB - timeA;
      })
    );

  useEffect(() => {
    const handleNavigateDetails = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (selectedDetailId === null || orderedRecords.length === 0) return;

      const currentIndex = orderedRecords.findIndex((record) => getDetailId(record) === selectedDetailId);
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;

      const nextDetail = toDetailRecord(nextRecord);
      window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: nextDetail }));
      setSelectedDetailId(getDetailId(nextRecord));
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
    };
  }, [orderedRecords, selectedDetailId]);

  const getWeekCount = () =>
    Object.values(filteredGroupedRecords).reduce((sum, recs) => sum + recs.length, 0);

  const searchOverlayTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading packer records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-white relative">
      {isRefreshing && (
        <div className="absolute right-2 top-2 z-30">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={formatHeaderDate()}
          count={currentCount || getWeekCount()}
          countClassName={counterColorClass}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          formatDate={formatDate}
        />
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <p className="text-gray-500 font-medium italic opacity-20">No packer records found</p>
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(filteredGroupedRecords)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, dateRecords]) => {
                  const sortedRecords = [...dateRecords].sort((a, b) => {
                    const timeA = new Date(a.created_at || 0).getTime();
                    const timeB = new Date(b.created_at || 0).getTime();
                    return timeB - timeA;
                  });
                  return (
                    <div key={date} className="flex flex-col">
                      <div
                        data-day-header
                        data-date={date}
                        data-count={dateRecords.length}
                        className="bg-gray-50/80 border-y border-gray-300 px-2 py-1 flex items-center justify-between z-10"
                      >
                        <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{formatDate(date)}</p>
                        <p className="text-[11px] font-black text-gray-900 tabular-nums">{dateRecords.length}</p>
                      </div>
                      {sortedRecords.map((record, index) => {
                        const displayValues = getOrderDisplayValues({
                          sku: record.sku,
                          condition: record.condition,
                          trackingNumber: record.shipping_tracking_number,
                        });
                        const rowIsFba = isFbaPackerRecord(record);
                        const fnskuValue = String(record.scan_ref || '').trim();
                        const showFnskuChip = rowIsFba && Boolean(fnskuValue);
                        const dotType = getSourceDotType({
                          orderId: record.order_id,
                          accountSource: record.account_source,
                          trackingType: record.tracking_type,
                          scanRef: record.scan_ref,
                        });
                        return (
                          <motion.div
                            {...framerPresence.tableRow}
                            transition={framerTransition.tableRowMount}
                            key={record.id}
                            onClick={() => openDetails(record)}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 transition-all border-b border-gray-300 cursor-pointer hover:bg-blue-50/40 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
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
                              <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest truncate mt-0.5 pl-4">
                                <span className={(parseInt(String(record.quantity || '1'), 10) || 1) > 1 ? 'text-yellow-600' : undefined}>
                                  {parseInt(String(record.quantity || '1'), 10) || 1}
                                </span> • {displayValues.condition || 'No Condition'}
                              </div>
                            </div>
                            <div className="flex items-center shrink-0">
                              {showFnskuChip ? (
                                <FnskuChip value={fnskuValue} />
                              ) : (() => {
                                const plat = getOrderPlatformLabel(record.order_id || '', record.account_source);
                                return (
                                  <>
                                    {plat ? (
                                      <PlatformChip
                                        label={plat}
                                        underlineClass={getOrderPlatformBorderColor(plat)}
                                        iconClass={record.item_number ? getOrderPlatformColor(plat) : 'text-gray-500'}
                                        onClick={() => {
                                          const url = getExternalUrlByItemNumber(record.item_number);
                                          if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                        }}
                                      />
                                    ) : null}
                                    <OrderIdChip
                                      value={record.order_id || ''}
                                      display={getLast4(record.order_id)}
                                    />
                                    <TrackingChip
                                      value={record.shipping_tracking_number || ''}
                                      display={getLast4(record.shipping_tracking_number)}
                                    />
                                  </>
                                );
                              })()}
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
      <AnimatePresence initial={false} mode="wait">
        {showSearch ? (
          <div key="packer-search-bar" className="absolute bottom-3 left-3 z-30 w-[320px]">
            <OverlaySearchBar
              value={searchInput}
              onChange={setSearchInput}
              inputRef={searchInputRef}
              placeholder="Search packed orders"
              variant="blue"
              className="w-full"
              onClear={clearSearch}
              onClose={clearSearch}
            />
          </div>
        ) : (
          <motion.button
            key="packer-search-trigger"
            type="button"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
            whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
            transition={searchOverlayTransition}
            onClick={openSearch}
            className="absolute bottom-3 left-3 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-600/25 will-change-transform transition hover:bg-blue-500"
            aria-label="Open packer search"
          >
            <Search className="h-4 w-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
