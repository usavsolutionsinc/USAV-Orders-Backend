'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertTriangle } from './Icons';
import { CopyableText } from './ui/CopyableText';
import WeekHeader from './ui/WeekHeader';
import { formatDateWithOrdinal } from '@/lib/date-format';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/lib/timezone';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { useStaffNameMap } from '@/hooks';

interface TechRecord {
  id: number;
  order_db_id?: number | null;
  test_date_time: string;
  shipping_tracking_number: string;
  serial_number: string;
  tested_by: number;
  ship_by_date?: string | null;
  created_at?: string | null;
  order_id: string | null;
  item_number?: string | null;
  product_title: string | null;
  quantity?: string | null;
  condition: string | null;
  sku: string | null;
  account_source?: string | null;
  notes?: string | null;
  out_of_stock?: string | null;
  is_shipped?: boolean;
}

interface TechTableProps {
  testedBy: number; // Filter by tester ID
}

export function TechTable({ testedBy }: TechTableProps) {
  const { getStaffName } = useStaffNameMap();
  const [records, setRecords] = useState<TechRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRecords();
  }, [testedBy]);

  useEffect(() => {
    const handleRefresh = () => fetchRecords();
    window.addEventListener('usav-refresh-data', handleRefresh as any);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh as any);
  }, [testedBy]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tech-logs?techId=${testedBy}&limit=5000`, { cache: 'no-store' });
      const data = await res.json();
      
      console.log('Fetched tech records:', data.length || 0);
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching tech records:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);
  const openDetails = (record: TechRecord) => {
    const detail: ShippedOrder & { tech_serial_id?: number } = {
      id: record.order_db_id ?? record.id,
      ship_by_date: record.ship_by_date || '',
      order_id: record.order_id || '',
      product_title: record.product_title || '',
      item_number: record.item_number || null,
      condition: record.condition || '',
      shipping_tracking_number: record.shipping_tracking_number || '',
      serial_number: record.serial_number || '',
      sku: record.sku || '',
      tester_id: null,
      tested_by: record.tested_by || null,
      test_date_time: record.test_date_time || null,
      packer_id: null,
      packed_by: null,
      pack_date_time: null,
      packer_photos_url: [],
      tracking_type: null,
      account_source: record.account_source || null,
      notes: record.notes || '',
      status_history: [],
      is_shipped: !!record.is_shipped,
      created_at: record.created_at || null,
      quantity: record.quantity || '1',
      tech_serial_id: record.id,
    };
    window.dispatchEvent(new CustomEvent('open-shipped-details', { detail }));
  };
  const getLast4 = (value: string | null | undefined) => {
    const raw = String(value || '');
    return raw.length > 4 ? raw.slice(-4) : raw || '---';
  };

  const formatHeaderDate = () => {
    return formatDate(getCurrentPSTDateKey());
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
      setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, records]);

  // Group records by date (using test_date_time)
  const groupedRecords: { [key: string]: TechRecord[] } = {};
  records.forEach(record => {
    if (!record.test_date_time) return;
    
    let date = '';
    try {
      date = toPSTDateKey(record.test_date_time) || 'Unknown';
    } catch (e) {
      date = 'Unknown';
    }
    
    if (!groupedRecords[date]) groupedRecords[date] = [];
    groupedRecords[date].push(record);
  });

  // Calculate week date range based on weekOffset (Monday-Friday only)
  const getWeekRange = () => {
    const todayPst = getCurrentPSTDateKey();
    const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
    const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
    const currentDay = now.getDay();
    const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday - (weekOffset * 7));
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
  };

  const weekRange = getWeekRange();
  const filteredGroupedRecords = Object.fromEntries(
    Object.entries(groupedRecords).filter(([date]) => {
      return date >= weekRange.startStr && date <= weekRange.endStr;
    })
  );

  const getWeekCount = () => {
    return Object.values(filteredGroupedRecords).reduce((sum, records) => sum + records.length, 0);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-600">Loading tech records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-white relative">
      {/* Main table container */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sticky header */}
        <WeekHeader
          stickyDate={stickyDate}
          fallbackDate={formatHeaderDate()}
          count={currentCount || getWeekCount()}
          countClassName="text-emerald-600"
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffset(weekOffset + 1)}
          onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          formatDate={formatDate}
        />
        
        {/* Logs List */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(filteredGroupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <p className="text-gray-500 font-medium italic opacity-20">No tech records found</p>
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(filteredGroupedRecords)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, dateRecords]) => {
                  // Sort records within each day by test_date_time (latest first)
                  const sortedRecords = [...dateRecords].sort((a, b) => {
                    const timeA = new Date(a.test_date_time || 0).getTime();
                    const timeB = new Date(b.test_date_time || 0).getTime();
                    return timeB - timeA;
                  });
                  
                  return (
                  <div key={date} className="flex flex-col">
                    <div 
                      data-day-header
                      data-date={date}
                      data-count={dateRecords.length}
                      className="bg-gray-50/80 border-y border-gray-100 px-2 py-1 flex items-center justify-between z-10"
                    >
                      <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{formatDate(date)}</p>
                      <p className="text-[11px] font-black text-gray-400 uppercase">Total: {dateRecords.length} Units</p>
                    </div>
                    {sortedRecords.map((record, index) => {
                      return (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          key={record.id}
                          onClick={() => openDetails(record)}
                          className={`grid grid-cols-[1fr_auto_70px] items-center gap-2 px-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/40 ${
                            index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                          }`}
                        >
                          {/* 1. Product Title & Condition */}
                          <div className="flex flex-col min-w-0">
                            <div className="text-[11px] font-bold text-gray-900 truncate">
                              {record.product_title || 'Unknown Product'}
                            </div>
                            <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest truncate mt-0.5">
                              {parseInt(String(record.quantity || '1'), 10) || 1} • {getStaffName(record.tested_by)} • {record.condition || 'No Condition'} • {record.sku || 'No SKU'}
                            </div>
                          </div>
                          
                          <div className="flex items-start justify-end gap-1.5">
                            {/* 2. Order ID */}
                            <div className="flex flex-col w-[60px]">
                              <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-0.5">Order ID</span>
                              <CopyableText 
                                text={record.order_id || 'N/A'}
                                displayText={getLast4(record.order_id)}
                                className="text-[10px] font-mono font-bold text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100"
                                variant="order"
                              />
                            </div>
                            
                            {/* 3. Tracking Number */}
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
                          
                          {/* 4. Serial Number */}
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
  );
}
