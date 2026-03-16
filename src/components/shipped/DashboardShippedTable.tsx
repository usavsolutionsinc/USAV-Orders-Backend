'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Loader2, Search } from '@/components/Icons';
import { CopyableText } from '@/components/ui/CopyableText';
import WeekHeader from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { isFbaOrder } from '@/utils/order-platform';
import { fetchDashboardShippedData } from '@/lib/dashboard-table-data';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { DateGroupHeader } from './DateGroupHeader';

export interface DashboardShippedTableProps {
  packedBy?: number;
  testedBy?: number;
}

export function DashboardShippedTable({
  packedBy,
  testedBy,
}: DashboardShippedTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { getStaffName } = useStaffNameMap();
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const search = searchParams.get('search') || '';
  const openOrderId = Number.parseInt(searchParams.get('openOrderId') || '', 10);
  const weekOffset = Math.max(0, Number.parseInt(searchParams.get('shippedWeekOffset') || '0', 10) || 0);
  const weekRange = getWeekRangeForOffset(weekOffset);
  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

  const queryKey = search.trim()
    ? (['dashboard-table', 'shipped', { search, packedBy, testedBy }] as const)
    : (['dashboard-table', 'shipped', { weekStart: weekRange.startStr, weekEnd: weekRange.endStr, packedBy, testedBy }] as const);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      fetchDashboardShippedData({
        searchQuery: search,
        packedBy,
        testedBy,
        weekStart: search.trim() ? undefined : weekRange.startStr,
        weekEnd: search.trim() ? undefined : weekRange.endStr,
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
      if (e.detail) setSelectedShipped(e.detail);
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

  const records = query.data || [];

  useEffect(() => {
    if (!Number.isFinite(openOrderId)) return;
    const match = records.find((record) => Number(record.id) === openOrderId);
    if (!match) return;

    window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: match }));

    const params = new URLSearchParams(searchParams.toString());
    params.delete('openOrderId');
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  }, [records, openOrderId, pathname, router, searchParams]);

  const handleRowClick = useCallback((record: ShippedOrder) => {
    if (selectedShipped && Number(selectedShipped.id) === Number(record.id)) {
      dispatchCloseShippedDetails();
      setSelectedShipped(null);
      return;
    }

    window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: record }));
    setSelectedShipped(record);
  }, [selectedShipped]);

  const groupedRecords: Record<string, ShippedOrder[]> = {};
  records.forEach((record) => {
    const dateSource = record.packed_at || record.created_at;
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
        const timeA = new Date(a.packed_at || a.created_at || 0).getTime();
        const timeB = new Date(b.packed_at || b.created_at || 0).getTime();
        return timeB - timeA;
      })
    );

  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (!selectedShipped || orderedRecords.length === 0) return;

      const currentIndex = orderedRecords.findIndex((record) => Number(record.id) === Number(selectedShipped.id));
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = orderedRecords[currentIndex + step];
      if (!nextRecord) return;

      window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: nextRecord }));
      setSelectedShipped(nextRecord);
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigate as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigate as any);
    };
  }, [orderedRecords, selectedShipped]);

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
  const getLast4 = (value: string | null | undefined) => {
    const raw = String(value || '');
    return raw.length > 4 ? raw.slice(-4) : raw || '---';
  };
  const getDaysLateNumber = (deadlineAt: string | null | undefined): number | null => {
    const deadlineKey = toPSTDateKey(deadlineAt);
    if (!deadlineKey) return null;
    const todayKey = getCurrentPSTDateKey();
    if (!todayKey) return null;
    const [dy, dm, dd] = deadlineKey.split('-').map(Number);
    const [ty, tm, td] = todayKey.split('-').map(Number);
    const deadlineIndex = Math.floor(Date.UTC(dy, dm - 1, dd) / 86400000);
    const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
    return Math.max(0, todayIndex - deadlineIndex);
  };
  const getDaysLateTone = (daysLate: number | null) => {
    if (daysLate === null) return 'text-gray-300';
    if (daysLate > 1) return 'text-red-600';
    if (daysLate === 1) return 'text-yellow-600';
    return 'text-emerald-600';
  };

  if (query.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading shipped records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 bg-white relative">
        <div className="flex-1 flex flex-col overflow-hidden">
          <WeekHeader
            stickyDate={stickyDate}
            fallbackDate={fallbackDate}
            count={currentCount || totalCount}
            countClassName="text-blue-600"
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={() => setWeekOffsetInUrl(weekOffset + 1)}
            onNextWeek={() => setWeekOffsetInUrl(Math.max(0, weekOffset - 1))}
            formatDate={formatDate}
            showWeekControls
          />

          <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
            {Object.keys(groupedRecords).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-40 text-center">
                {search ? (
                  <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                    <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Search className="w-8 h-8 text-red-400" />
                    </div>
                    <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">Order not found</h3>
                    <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                      We couldn&apos;t find any records matching &quot;{search}&quot;
                    </p>
                    <button
                      type="button"
                      onClick={clearSearch}
                      className="mt-6 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
                    >
                      Show All Orders
                    </button>
                  </div>
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
                      const timeA = new Date(a.packed_at || a.created_at || 0).getTime();
                      const timeB = new Date(b.packed_at || b.created_at || 0).getTime();
                      return timeB - timeA;
                    });

                    return (
                      <div key={date} className="flex flex-col">
                        <DateGroupHeader date={date} total={dayRecords.length} formatDate={formatDate} />
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
                          const isFba = isFbaOrder(record.order_id, record.account_source);
                          const defaultDaysLate = getDaysLateNumber(record.deadline_at as any);

                          return (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              key={record.id}
                              onClick={() => handleRowClick(record)}
                              data-order-row-id={String(record.id)}
                              className={`grid grid-cols-[1fr_auto_70px] items-center gap-2 px-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                                selectedShipped?.id === record.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                              }`}
                            >
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  {isFba ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-purple-500" title="FBA" /> : null}
                                  <div className="text-[12px] font-bold text-gray-900 truncate">
                                    {record.product_title || 'Unknown Product'}
                                  </div>
                                </div>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate min-w-0 flex-1">
                                    <span className={String(record.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : undefined}>
                                      {record.condition || 'No Condition'}
                                    </span>
                                    {' • '}
                                    {testerName}
                                    {' • '}
                                    {packerName}
                                    {defaultDaysLate !== null ? (
                                      <>
                                        {' • '}
                                        <span className={getDaysLateTone(defaultDaysLate)}>{defaultDaysLate}</span>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-start justify-end gap-1.5">
                                <div className="flex flex-col w-[60px]">
                                  <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-0.5">Order ID</span>
                                  <CopyableText
                                    text={record.order_id || ''}
                                    displayText={getLast4(record.order_id)}
                                    className="text-[10px] font-mono font-bold text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100"
                                    variant="order"
                                  />
                                </div>

                                <div className="flex flex-col w-[60px]">
                                  <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter mb-0.5">Track</span>
                                  <CopyableText
                                    text={(record as any).tracking_number || record.shipping_tracking_number || ''}
                                    displayText={getLast4((record as any).tracking_number || record.shipping_tracking_number)}
                                    className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"
                                    variant="default"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-col w-[70px]">
                                <span className="text-[8px] font-black text-emerald-400 uppercase tracking-tighter mb-0.5">Serial</span>
                                <CopyableText
                                  text={record.serial_number || ''}
                                  className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100"
                                  variant="serial"
                                />
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
