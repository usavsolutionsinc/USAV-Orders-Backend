'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { CopyableText } from '../ui/CopyableText';
import WeekHeader from '../ui/WeekHeader';
import { formatDateWithOrdinal } from '@/lib/date-format';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { dmSans } from '@/lib/fonts';
import { DateGroupHeader } from './DateGroupHeader';

export interface ShippedTableBaseProps {
  packedBy?: number; // Filter by packer ID
  testedBy?: number; // Filter by tester ID
  ordersOnly?: boolean;
  missingTrackingOnly?: boolean;
  showWeekNavigation?: boolean;
}

export function ShippedTableBase({
  packedBy,
  testedBy,
  ordersOnly = false,
  missingTrackingOnly = false,
  showWeekNavigation = true,
}: ShippedTableBaseProps = {}) {
  const { getStaffName } = useStaffNameMap();
  const searchParams = useSearchParams();
  const search = searchParams.get('search') || '';
  const [shipped, setShipped] = useState<ShippedOrder[]>([]);
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = current week, 1 = previous week, etc.
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [relaxedSearchMatches, setRelaxedSearchMatches] = useState<ShippedOrder[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasLoadedRef = useRef(false);
  const { normalizeTrackingQuery } = useLast8TrackingSearch();

  const fetchShipped = useCallback(async () => {
    if (hasLoadedRef.current) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const url = ordersOnly
        ? '/api/orders'
        : (
          search
            ? `/api/shipped?q=${encodeURIComponent(search)}`
            : `/api/shipped?limit=5000`
        );
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      
      let records = data.results || data.shipped || [];
      if (ordersOnly) {
        records = (data.orders || []).map((order: any) => ({
          ...order,
          pack_date_time: order.ship_by_date || null,
          packed_by: order.packer_id ?? null,
          tested_by: order.tester_id ?? null,
          serial_number: '',
          condition: order.condition || '',
        }));
      }

      if (missingTrackingOnly) {
        records = records.filter((record: any) => {
          const tracking = String(record.shipping_tracking_number || '').trim();
          return tracking.length === 0;
        });
      }

      // Apply client-side filters if provided
      if (packedBy !== undefined) {
        records = records.filter((record: ShippedOrder) => record.packed_by === packedBy);
      }
      if (testedBy !== undefined) {
        records = records.filter((record: ShippedOrder) => record.tested_by === testedBy);
      }
      
      console.log('Fetched shipped records:', records.length);
      if (records.length > 0) {
        console.log('First record date:', records[0].pack_date_time);
        console.log('Last record date:', records[records.length - 1].pack_date_time);
      }
      setShipped(records);
    } catch (error) {
      console.error('Error fetching shipped records:', error);
    } finally {
      hasLoadedRef.current = true;
      setIsRefreshing(false);
      setLoading(false);
    }
  }, [search, packedBy, testedBy, ordersOnly, missingTrackingOnly]);

  useEffect(() => {
    fetchShipped();
  }, [fetchShipped]);

  useEffect(() => {
    const handleRefresh = () => {
      fetchShipped();
    };

    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
    };
  }, [fetchShipped]);

  useEffect(() => {
    const applyRowPatch = (row: any, detail: any) => {
      if (!row) return row;
      const next = { ...row };
      if (detail.testerId !== undefined) {
        next.tester_id = detail.testerId;
        next.tested_by = detail.testerId;
      }
      if (detail.packerId !== undefined) {
        next.packer_id = detail.packerId;
        next.packed_by = detail.packerId;
      }
      if (detail.shipByDate !== undefined) next.ship_by_date = detail.shipByDate;
      if (detail.outOfStock !== undefined) next.out_of_stock = detail.outOfStock;
      if (detail.notes !== undefined) next.notes = detail.notes;
      if (detail.shippingTrackingNumber !== undefined) next.shipping_tracking_number = detail.shippingTrackingNumber;
      if (detail.itemNumber !== undefined) next.item_number = detail.itemNumber;
      if (detail.condition !== undefined) next.condition = detail.condition;
      return next;
    };

    const handleAssignmentUpdate = (e: any) => {
      const detail = e?.detail || {};
      const ids = new Set<number>((detail.orderIds || []).map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id)));
      if (ids.size === 0) return;

      setShipped((current) => current.map((row) => (ids.has(Number(row.id)) ? applyRowPatch(row, detail) : row)));
      setSelectedShipped((current) => (current && ids.has(Number(current.id)) ? applyRowPatch(current, detail) : current));
    };

    window.addEventListener('order-assignment-updated' as any, handleAssignmentUpdate as any);
    return () => window.removeEventListener('order-assignment-updated' as any, handleAssignmentUpdate as any);
  }, []);

  useEffect(() => {
    if (!ordersOnly) return;

    const handleDashboardSearch = (e: any) => {
      setDashboardSearch(String(e?.detail?.query || '').trim());
    };

    window.addEventListener('dashboard-search' as any, handleDashboardSearch as any);

    return () => {
      window.removeEventListener('dashboard-search' as any, handleDashboardSearch as any);
    };
  }, [ordersOnly, fetchShipped]);

  const activeSearch = ordersOnly ? dashboardSearch : search;
  const normalizedSearch = activeSearch ? normalizeTrackingQuery(activeSearch) : '';
  const searchDigits = normalizedSearch.replace(/\D/g, '');
  const last8 = searchDigits.slice(-8);

  useEffect(() => {
    if (!ordersOnly || missingTrackingOnly || !normalizedSearch) {
      setRelaxedSearchMatches([]);
      return;
    }

    let cancelled = false;

    const fetchRelaxedMatches = async () => {
      try {
        const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(activeSearch)}`, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setRelaxedSearchMatches([]);
          return;
        }
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        if (cancelled) return;
        setRelaxedSearchMatches(
          results
            .filter((record: any) => record?.is_shipped === true || record?.is_shipped == null)
            .map((record: any) => ({
              ...record,
              ship_by_date: record.ship_by_date || record.created_at || null,
            }))
        );
      } catch (error) {
        if (!cancelled) setRelaxedSearchMatches([]);
      }
    };

    fetchRelaxedMatches();

    return () => {
      cancelled = true;
    };
  }, [ordersOnly, missingTrackingOnly, normalizedSearch, activeSearch]);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);
  const getLast4 = (value: string | null | undefined) => {
    const raw = String(value || '');
    return raw.length > 4 ? raw.slice(-4) : raw || '---';
  };
  const getDaysLateNumber = (shipByDate: string | null | undefined, fallbackDate?: string | null | undefined) => {
    const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDate);
    const todayKey = getCurrentPSTDateKey();
    if (!shipByKey || !todayKey) return 0;
    const [sy, sm, sd] = shipByKey.split('-').map(Number);
    const [ty, tm, td] = todayKey.split('-').map(Number);
    const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
    const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
    return Math.max(0, todayIndex - shipByIndex);
  };
  const getDaysLateTone = (daysLate: number) => {
    if (daysLate > 1) return 'text-red-600';
    if (daysLate === 1) return 'text-yellow-600';
    return 'text-emerald-600';
  };

  const formatHeaderDate = () => {
    const todayPst = getCurrentPSTDateKey();
    return formatDate(todayPst);
  };

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
      // Initial call to set the sticky date and count
      setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, shipped]);

  // Listen for external open/close events to sync selection state
  useEffect(() => {
    const handleOpen = (e: CustomEvent<ShippedOrder>) => {
      if (e.detail) {
        setSelectedShipped(e.detail);
      }
    };
    const handleClose = () => {
      setSelectedShipped(null);
    };

    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    
    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, []);

  const handleRowClick = useCallback((record: ShippedOrder) => {
    const event = new CustomEvent('open-shipped-details', { detail: record });
    window.dispatchEvent(event);
    setSelectedShipped(record);
  }, []);

  const strictFilteredRecords = (ordersOnly && normalizedSearch)
    ? shipped.filter((record) => {
        const productTitle = String(record.product_title || '').toLowerCase();
        const orderId = String(record.order_id || '').toLowerCase();
        const sku = String(record.sku || '').toLowerCase();
        const tracking = String(record.shipping_tracking_number || '').toLowerCase();
        const serial = String(record.serial_number || '').toLowerCase();
        const queryLower = normalizedSearch.toLowerCase();

        const directMatch =
          orderId === queryLower ||
          tracking === queryLower ||
          productTitle.includes(queryLower) ||
          orderId.includes(queryLower) ||
          sku.includes(queryLower) ||
          tracking.includes(queryLower) ||
          serial.includes(queryLower);

        const last8Match =
          !!last8 &&
          last8.length >= 8 &&
          (tracking.replace(/\D/g, '').slice(-8) === last8 ||
           orderId.replace(/\D/g, '').slice(-8) === last8);

        return directMatch || last8Match;
      })
    : shipped;

  const filteredRecords = (() => {
    if (!(ordersOnly && normalizedSearch) || missingTrackingOnly) return strictFilteredRecords;
    if (relaxedSearchMatches.length === 0) return strictFilteredRecords;

    const merged = [...strictFilteredRecords];
    const seen = new Set(
      strictFilteredRecords.map((record) => `${String((record as any).row_source || 'order')}:${String(record.id)}`)
    );

    for (const record of relaxedSearchMatches) {
      const key = `${String((record as any).row_source || 'order')}:${String(record.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(record);
    }

    return merged;
  })();

  useEffect(() => {
    if (!ordersOnly || !normalizedSearch) return;
    if (filteredRecords.length === 1) {
      handleRowClick(filteredRecords[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordersOnly, normalizedSearch, filteredRecords.length]);

  // Group records by date (using ship_by_date for orders view, pack_date_time otherwise)
  const groupedShipped: { [key: string]: ShippedOrder[] } = {};
  filteredRecords.forEach(record => {
    const dateSource = ordersOnly
      ? (record.ship_by_date || record.created_at)
      : record.pack_date_time;
    if (!dateSource || dateSource === '1') return;
    
    let date = '';
    try {
      date = toPSTDateKey(String(dateSource));
      if (!date) date = 'Unknown';
    } catch (e) {
      date = 'Unknown';
    }
    
    if (!groupedShipped[date]) groupedShipped[date] = [];
    groupedShipped[date].push(record);
  });

  // Get today's count for initial display
  const getTodayCount = () => {
    const today = getCurrentPSTDateKey();
    return groupedShipped[today]?.length || 0;
  };

  // Calculate week date range based on weekOffset (Monday-Friday only)
  const getWeekRange = () => {
    const todayPst = getCurrentPSTDateKey();
    const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
    const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
    
    // Calculate the Monday of the current week
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1; // If Sunday, go back 6 days, else go back to Monday
    
    // Get Monday of the target week (accounting for weekOffset)
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday - (weekOffset * 7));
    monday.setHours(0, 0, 0, 0);
    
    // Get Friday of the same week (4 days after Monday)
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    friday.setHours(23, 59, 59, 999);

    return {
      start: monday,
      end: friday,
      startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
      endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`
    };
  };

  // Filter grouped data by current week (all data is weekdays, so no need to filter by day of week)
  const weekRange = getWeekRange();
  const filteredGroupedShipped = activeSearch || ordersOnly
    ? groupedShipped
    : Object.fromEntries(
        Object.entries(groupedShipped).filter(([date]) => {
          // Check if date is in range (Monday-Friday of the target week)
          return date >= weekRange.startStr && date <= weekRange.endStr;
        })
      );

  const displayedRecords = Object.entries(filteredGroupedShipped)
    .sort((a, b) => (ordersOnly ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
    .flatMap(([_, records]) => {
      const sortedRecords = [...records].sort((a, b) => {
        const timeA = new Date(a.pack_date_time || 0).getTime();
        const timeB = new Date(b.pack_date_time || 0).getTime();
        return ordersOnly ? timeA - timeB : timeB - timeA;
      });
      return sortedRecords;
    });

  useEffect(() => {
    if (!ordersOnly) return;

    const isUnassignedRecord = (record: ShippedOrder) => {
      return (record as any).tester_id == null && (record as any).packer_id == null;
    };

    const handleNavigate = (e: any) => {
      const direction = e?.detail?.direction === 'up' ? 'up' : e?.detail?.direction === 'down' ? 'down' : null;
      if (!direction || displayedRecords.length === 0) return;

      const currentIndex = displayedRecords.findIndex((record) => record.id === selectedShipped?.id);
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        direction === 'up'
          ? Math.max(0, safeCurrentIndex - 1)
          : Math.min(displayedRecords.length - 1, safeCurrentIndex + 1);

      const nextRecord = displayedRecords[nextIndex];
      if (!nextRecord || nextRecord.id === selectedShipped?.id) return;

      handleRowClick(nextRecord);
      window.setTimeout(() => {
        const targetEl = scrollRef.current?.querySelector(`[data-order-row-id="${String(nextRecord.id)}"]`) as HTMLElement | null;
        targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    };

    const handleNavigateNextUnassigned = () => {
      if (displayedRecords.length === 0) return;

      const currentIndex = displayedRecords.findIndex((record) => record.id === selectedShipped?.id);
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : -1;

      const nextRecord =
        displayedRecords.find((record, index) => index > safeCurrentIndex && isUnassignedRecord(record)) ||
        displayedRecords.find((record) => isUnassignedRecord(record));

      if (!nextRecord || nextRecord.id === selectedShipped?.id) return;

      handleRowClick(nextRecord);
      window.setTimeout(() => {
        const targetEl = scrollRef.current?.querySelector(`[data-order-row-id="${String(nextRecord.id)}"]`) as HTMLElement | null;
        targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    };

    window.addEventListener('navigate-dashboard-order' as any, handleNavigate as any);
    window.addEventListener('navigate-dashboard-next-unassigned' as any, handleNavigateNextUnassigned as any);
    return () => {
      window.removeEventListener('navigate-dashboard-order' as any, handleNavigate as any);
      window.removeEventListener('navigate-dashboard-next-unassigned' as any, handleNavigateNextUnassigned as any);
    };
  }, [displayedRecords, handleRowClick, selectedShipped?.id, ordersOnly]);

  // Get total count for current week
  const getWeekCount = () => {
    return Object.values(filteredGroupedShipped).reduce((sum, records) => sum + records.length, 0);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">
            {ordersOnly ? 'Loading order records...' : 'Loading shipped records...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white relative">
      {/* Main table container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sticky header */}
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={formatHeaderDate()}
          count={currentCount || getWeekCount()}
          countClassName="text-blue-600"
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          formatDate={formatDate}
          rightSlot={
            showWeekNavigation
              ? undefined
              : (
                <div className="min-w-[18px] flex items-center justify-end">
                  {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> : null}
                </div>
              )
          }
        />
        
        {/* Logs List */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(filteredGroupedShipped).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {activeSearch ? (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">Order not found</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                    We couldn't find any records matching "{activeSearch}"
                  </p>
                  <button 
                    onClick={() => {
                      if (ordersOnly) {
                        setDashboardSearch('');
                        window.dispatchEvent(new CustomEvent('dashboard-search', { detail: { query: '' } }));
                      } else {
                        window.history.pushState({}, '', '/shipped');
                      }
                    }}
                    className="mt-6 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
                  >
                    Show All Orders
                  </button>
                </div>
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-gray-500 font-medium italic opacity-20">
                    {ordersOnly ? 'No order records found' : 'No shipped records for this week'}
                  </p>
                  {weekOffset > 0 && (
                    <button 
                      onClick={() => setWeekOffset(0)}
                      className="mt-4 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
                    >
                      Go to Current Week
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(filteredGroupedShipped)
                .sort((a, b) => ordersOnly ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]))
                .map(([date, records]) => {
                  // Sort records within each day by pack_date_time (latest first)
                  const sortedRecords = [...records].sort((a, b) => {
                    const timeA = new Date(a.pack_date_time || 0).getTime();
                    const timeB = new Date(b.pack_date_time || 0).getTime();
                    return ordersOnly ? timeA - timeB : timeB - timeA;
                  });
                  
                  return (
                  <div key={date} className="flex flex-col">
                    <DateGroupHeader date={date} total={records.length} formatDate={formatDate} />
                    {sortedRecords.map((record, index) => {
                      const testerName =
                        (record as any).tested_by_name ||
                        (record as any).tester_name ||
                        getStaffName((record as any).tested_by) ||
                        getStaffName((record as any).tester_id);
                      const packerName =
                        (record as any).packed_by_name ||
                        (record as any).packer_name ||
                        getStaffName((record as any).packed_by) ||
                        getStaffName((record as any).packer_id);

                      return (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          key={record.id}
                          onClick={() => handleRowClick(record)}
                          data-order-row-id={String(record.id)}
                          className={`grid ${ordersOnly ? 'grid-cols-[1fr_auto]' : 'grid-cols-[1fr_auto_70px]'} items-center gap-2 px-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                            selectedShipped?.id === record.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                          }`}
                        >
                          {/* 2. Product Title, Tested By, Packed By, Condition & SKU */}
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {String((record as any).out_of_stock || '').trim() !== '' && (
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Out of stock" />
                              )}
                              <div className="text-[12px] font-bold text-gray-900 truncate">
                                {record.product_title || 'Unknown Product'}
                              </div>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate min-w-0 flex-1">
                                {(() => {
                                  const qty = parseInt(String((record as any).quantity || '1'), 10) || 1;
                                  const qtyClass = qty > 1 ? 'text-yellow-600' : 'text-gray-400';
                                  return (
                                    <>
                                      <span className={qtyClass}>{qty}</span>
                                      {' • '}
                                    </>
                                  );
                                })()}
                                <span className={String(record.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : undefined}>{record.condition || 'No Condition'}</span> • {testerName} • {packerName}{ordersOnly && (
                                  <>
                                    {' • '}
                                    <span className={getDaysLateTone(getDaysLateNumber(record.ship_by_date as any, record.created_at as any))}>
                                      {getDaysLateNumber(record.ship_by_date as any, record.created_at as any)}
                                    </span>
                                    {String((record as any).out_of_stock || '').trim() !== '' && (
                                      <>
                                        {' • '}
                                        <span className="text-red-600">
                                          {String((record as any).out_of_stock || '').trim()}
                                        </span>
                                      </>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-start justify-end gap-1.5">
                            {/* 3. Order ID */}
                            <div className="flex flex-col w-[60px]">
                              <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-0.5">Order ID</span>
                              <CopyableText 
                                text={record.order_id || ''}
                                displayText={getLast4(record.order_id)}
                                className="text-[10px] font-mono font-bold text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100"
                                variant="order"
                              />
                            </div>
                            
                            {/* 4. Tracking Number */}
                            <div className="flex flex-col w-[60px]">
                              <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter mb-0.5">Tracking</span>
                              <CopyableText 
                                text={record.shipping_tracking_number || ''}
                                displayText={getLast4(record.shipping_tracking_number)}
                                className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"
                                variant="tracking"
                              />
                            </div>
                          </div>
                          
                          {!ordersOnly && (
                            <div className="flex flex-col w-[70px]">
                              <span className="text-[8px] font-black text-emerald-400 uppercase tracking-tighter mb-0.5">Serial</span>
                              <CopyableText 
                                text={record.serial_number || ''} 
                                className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100"
                                variant="serial"
                              />
                            </div>
                          )}

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
      
      {/* Details Panel - Overlay is now handled by ShippedSidebar via global events to prevent multiple overlays */}
    </div>
  );
}
