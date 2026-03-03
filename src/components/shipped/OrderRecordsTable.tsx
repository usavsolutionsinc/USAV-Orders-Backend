'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Search } from '@/components/Icons';
import { CopyableText } from '@/components/ui/CopyableText';
import WeekHeader from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal } from '@/lib/date-format';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { DateGroupHeader } from './DateGroupHeader';

interface WeekRange {
  startStr: string;
  endStr: string;
}

interface OrderRecordsTableProps {
  records: ShippedOrder[];
  loading: boolean;
  isRefreshing: boolean;
  searchValue: string;
  ordersOnly?: boolean;
  showWeekControls?: boolean;
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onResetWeek?: () => void;
  onClearSearch: () => void;
  emptyMessage?: string;
}

export function OrderRecordsTable({
  records,
  loading,
  isRefreshing,
  searchValue,
  ordersOnly = false,
  showWeekControls = false,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  onResetWeek,
  onClearSearch,
  emptyMessage,
}: OrderRecordsTableProps) {
  const { getStaffName } = useStaffNameMap();
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

  const handleRowClick = useCallback((record: ShippedOrder) => {
    if (selectedShipped && Number(selectedShipped.id) === Number(record.id)) {
      dispatchCloseShippedDetails();
      setSelectedShipped(null);
      return;
    }

    window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: record }));
    setSelectedShipped(record);
  }, [selectedShipped]);

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

  const groupedRecords: Record<string, ShippedOrder[]> = {};
  records.forEach((record) => {
    const dateSource = ordersOnly ? (record.ship_by_date || record.created_at) : record.pack_date_time;
    if (!dateSource || dateSource === '1') return;

    let date = '';
    try {
      date = toPSTDateKey(String(dateSource));
      if (!date) date = 'Unknown';
    } catch {
      date = 'Unknown';
    }

    if (!groupedRecords[date]) groupedRecords[date] = [];
    groupedRecords[date].push(record);
  });

  const displayedRecords = Object.entries(groupedRecords)
    .sort((a, b) => (ordersOnly ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
    .flatMap(([_, dayRecords]) => {
      const sortedRecords = [...dayRecords].sort((a, b) => {
        const aSource = ordersOnly ? (a.ship_by_date || a.created_at) : (a.pack_date_time || a.created_at);
        const bSource = ordersOnly ? (b.ship_by_date || b.created_at) : (b.pack_date_time || b.created_at);
        const timeA = new Date(aSource || 0).getTime();
        const timeB = new Date(bSource || 0).getTime();
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

      if (!nextRecord || nextRecord.id === selectedShipped?.id) {
        dispatchCloseShippedDetails();
        setSelectedShipped(null);
        return;
      }

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
  }, [displayedRecords, handleRowClick, ordersOnly, selectedShipped?.id]);

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
  const getDaysLateNumber = (shipByDate: string | null | undefined, fallbackDateValue?: string | null | undefined) => {
    const shipByKey = toPSTDateKey(shipByDate) || toPSTDateKey(fallbackDateValue);
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
      <div className="flex-1 flex flex-col overflow-hidden">
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={fallbackDate}
          count={currentCount || totalCount}
          countClassName="text-blue-600"
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={onPrevWeek}
          onNextWeek={onNextWeek}
          formatDate={formatDate}
          showWeekControls={showWeekControls}
          rightSlot={
            showWeekControls
              ? undefined
              : (
                <div className="min-w-[18px] flex items-center justify-end">
                  {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" /> : null}
                </div>
              )
          }
        />

        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(groupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {searchValue ? (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">Order not found</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                    We couldn&apos;t find any records matching &quot;{searchValue}&quot;
                  </p>
                  <button
                    type="button"
                    onClick={onClearSearch}
                    className="mt-6 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
                  >
                    Show All Orders
                  </button>
                </div>
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-gray-500 font-medium italic opacity-20">
                    {emptyMessage || (ordersOnly ? 'No order records found' : 'No shipped records for this view')}
                  </p>
                  {showWeekControls && weekOffset > 0 && onResetWeek ? (
                    <button
                      type="button"
                      onClick={onResetWeek}
                      className="mt-4 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
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
                .sort((a, b) => (ordersOnly ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
                .map(([date, dayRecords]) => {
                  const sortedRecords = [...dayRecords].sort((a, b) => {
                    const aSource = ordersOnly ? (a.ship_by_date || a.created_at) : (a.pack_date_time || a.created_at);
                    const bSource = ordersOnly ? (b.ship_by_date || b.created_at) : (b.pack_date_time || b.created_at);
                    const timeA = new Date(aSource || 0).getTime();
                    const timeB = new Date(bSource || 0).getTime();
                    return ordersOnly ? timeA - timeB : timeB - timeA;
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
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                {ordersOnly && String((record as any).out_of_stock || '').trim() === '' ? (
                                  <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" title="Pending order" />
                                ) : null}
                                {String((record as any).out_of_stock || '').trim() !== '' ? (
                                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Out of stock" />
                                ) : null}
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
                                  <span className={String(record.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : undefined}>
                                    {record.condition || 'No Condition'}
                                  </span>
                                  {' • '}
                                  {testerName}
                                  {' • '}
                                  {packerName}
                                  {ordersOnly ? (
                                    <>
                                      {' • '}
                                      <span className={getDaysLateTone(getDaysLateNumber(record.ship_by_date as any, record.created_at as any))}>
                                        {getDaysLateNumber(record.ship_by_date as any, record.created_at as any)}
                                      </span>
                                      {String((record as any).out_of_stock || '').trim() !== '' ? (
                                        <>
                                          {' • '}
                                          <span className="text-red-600">
                                            {String((record as any).out_of_stock || '').trim()}
                                          </span>
                                        </>
                                      ) : null}
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
                                <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter mb-0.5">Tracking</span>
                                <CopyableText
                                  text={record.shipping_tracking_number || ''}
                                  displayText={getLast4(record.shipping_tracking_number)}
                                  className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"
                                  variant="tracking"
                                />
                              </div>
                            </div>

                            {ordersOnly ? null : (
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
    </div>
  );
}
