'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertTriangle } from './Icons';
import { CopyableText } from './ui/CopyableText';

// Hard-coded staff ID to name mapping
const STAFF_NAMES: { [key: number]: string } = {
  1: 'Michael',
  2: 'Thuc',
  3: 'Sang',
  4: 'Tuan',
  5: 'Thuy',
  6: 'Cuong'
};

function getStaffName(staffId: number | null | undefined): string {
  if (!staffId) return '---';
  return STAFF_NAMES[staffId] || `#${staffId}`;
}

interface TechRecord {
  id: number;
  test_date_time: string;
  shipping_tracking_number: string;
  serial_number: string;
  tested_by: number;
  order_id: string | null;
  product_title: string | null;
  condition: string | null;
  sku: string | null;
}

interface TechTableProps {
  testedBy: number; // Filter by tester ID
}

export function TechTable({ testedBy }: TechTableProps) {
  const [records, setRecords] = useState<TechRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRecords();
  }, [testedBy]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tech-logs?techId=${testedBy}&limit=5000`);
      const data = await res.json();
      
      console.log('Fetched tech records:', data.length || 0);
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching tech records:', error);
    } finally {
      setLoading(false);
    }
  };

  const getOrdinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const formatDate = (dateStr: string) => {
    try {
      if (!dateStr) return 'Unknown';
      
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;

      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      
      const dayName = days[date.getDay()];
      const monthName = months[date.getMonth()];
      const dayNum = date.getDate();
      
      return `${dayName}, ${monthName} ${getOrdinal(dayNum)}`;
    } catch (e) { 
      return dateStr; 
    }
  };

  const formatHeaderDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return formatDate(`${year}-${month}-${day}`);
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
      const dateObj = new Date(record.test_date_time);
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      date = `${year}-${month}-${day}`;
    } catch (e) {
      date = 'Unknown';
    }
    
    if (!groupedRecords[date]) groupedRecords[date] = [];
    groupedRecords[date].push(record);
  });

  const getTodayCount = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    return groupedRecords[today]?.length || 0;
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
        <div className="flex-shrink-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-100 px-2 py-1 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-black text-gray-900 tracking-tight">
              {stickyDate || formatHeaderDate()}
            </p>
            <div className="h-2 w-px bg-gray-200" />
            <p className="text-[11px] font-black text-emerald-600 uppercase tracking-widest">
              Count: {currentCount || getTodayCount()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
              {getStaffName(testedBy)} - Tech Records
            </span>
          </div>
        </div>
        
        {/* Logs List */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(groupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              <p className="text-gray-500 font-medium italic opacity-20">No tech records found</p>
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(groupedRecords)
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
                      const ts = record.test_date_time;
                      return (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          key={record.id}
                          className={`grid grid-cols-[60px_1fr_94px_auto_70px] items-center gap-2 px-4 py-3 transition-all border-b border-gray-50 ${
                            index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                          }`}
                        >
                          {/* 1. Time */}
                          <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left flex items-center gap-2">
                            {ts ? (
                              (() => {
                                try {
                                  const dateObj = new Date(ts);
                                  return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                                } catch {
                                  return '--:--';
                                }
                              })()
                            ) : '--:--'}
                          </div>
                          
                          {/* 2. Product Title & Condition */}
                          <div className="flex flex-col min-w-0">
                            <div className="text-[11px] font-bold text-gray-900 truncate">
                              {record.product_title || 'Unknown Product'}
                            </div>
                            <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest truncate mt-0.5">
                              {record.condition || 'No Condition'} • {record.sku || 'No SKU'}
                            </div>
                          </div>
                          
                          {/* 3. Order ID */}
                          <div className="flex flex-col w-[94px]">
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-0.5">Order ID</span>
                            <CopyableText 
                              text={record.order_id || 'N/A'} 
                              className="text-[10px] font-mono font-bold text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100"
                              variant="order"
                            />
                          </div>
                          
                          {/* 4. Tracking Number */}
                          <div className="flex flex-col">
                            <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter mb-0.5">Tracking</span>
                            <CopyableText 
                              text={record.shipping_tracking_number || ''} 
                              className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100"
                              variant="tracking"
                            />
                          </div>
                          
                          {/* 5. Serial Number */}
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
