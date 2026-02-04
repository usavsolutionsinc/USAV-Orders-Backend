'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search, X, Copy, Check, AlertTriangle } from '../Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { ShippedDetailsPanel } from './ShippedDetailsPanel';
import { CopyableText } from '../ui/CopyableText';

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

export function ShippedTable() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search');
  const [shipped, setShipped] = useState<ShippedOrder[]>([]);
  const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchShipped();
  }, [search]);

  const fetchShipped = async () => {
    setLoading(true);
    try {
      const url = search 
        ? `/api/shipped/search?q=${encodeURIComponent(search)}`
        : `/api/shipped?limit=1000`;
      const res = await fetch(url);
      const data = await res.json();
      
      const records = data.results || data.shipped || [];
      setShipped(records);
    } catch (error) {
      console.error('Error fetching shipped records:', error);
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
      const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
      
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
    return formatDate(now.toISOString());
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

  const handleRowClick = (record: ShippedOrder) => {
    setSelectedShipped(record);
  };

  const handleCloseDetails = () => {
    setSelectedShipped(null);
  };

  const handleUpdate = () => {
    fetchShipped();
  };

  // Group records by date (using pack_date_time)
  const groupedShipped: { [key: string]: ShippedOrder[] } = {};
  shipped.forEach(record => {
    if (!record.pack_date_time || record.pack_date_time === '1') return;
    
    let date = '';
    try {
      const dateObj = new Date(record.pack_date_time);
      date = dateObj.toISOString().split('T')[0];
    } catch (e) {
      date = 'Unknown';
    }
    
    if (!groupedShipped[date]) groupedShipped[date] = [];
    groupedShipped[date].push(record);
  });

  // Get today's count for initial display
  const getTodayCount = () => {
    const today = new Date().toISOString().split('T')[0];
    return groupedShipped[today]?.length || 0;
  };

  if (loading) {
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
            <p className="text-[11px] font-black text-blue-600 uppercase tracking-widest">
              Count: {currentCount || getTodayCount()}
            </p>
          </div>
          {search && (
            <div className="flex items-center gap-2 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
              <Search className="w-3 h-3" />
              <span className="text-[9px] font-black uppercase tracking-widest">{search}</span>
              <button 
                onClick={() => window.history.pushState({}, '', '/shipped')}
                className="hover:text-blue-900 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
        </div>
        
        {/* Logs List */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {shipped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {search ? (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">Order not found</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                    We couldn't find any records matching "{search}"
                  </p>
                  <button 
                    onClick={() => window.history.pushState({}, '', '/shipped')}
                    className="mt-6 px-6 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 transition-all active:scale-95"
                  >
                    Show All Orders
                  </button>
                </div>
              ) : (
                <p className="text-gray-500 font-medium italic opacity-20">No shipped records found</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(groupedShipped)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, records]) => (
                  <div key={date} className="flex flex-col">
                    <div 
                      data-day-header
                      data-date={date}
                      data-count={records.length}
                      className="bg-gray-50/80 border-y border-gray-100 px-2 py-1 flex items-center justify-between z-10"
                    >
                      <p className="text-[11px] font-black text-gray-900 uppercase tracking-widest">{formatDate(date)}</p>
                      <p className="text-[11px] font-black text-gray-400 uppercase">Total: {records.length} Units</p>
                    </div>
                    {records.map((record, index) => {
                      const hasAlert = record.pack_date_time === '1';
                      const ts = record.pack_date_time;
                      return (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          key={record.id}
                          onClick={() => handleRowClick(record)}
                          className={`grid grid-cols-[60px_1fr_94px_auto_70px] items-center gap-2 px-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                            selectedShipped?.id === record.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                          }`}
                        >
                          {/* 1. Time */}
                          <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left flex items-center gap-2">
                            {hasAlert && <AlertTriangle className="w-3.5 h-3.5 text-red-600 animate-pulse" />}
                            {ts && ts !== '1' ? (
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
                          
                          {/* 2. Product Title, Tested By, Packed By, Condition & SKU */}
                          <div className="flex flex-col min-w-0">
                            <div className="text-[11px] font-bold text-gray-900 truncate">
                              {record.product_title || 'Unknown Product'}
                            </div>
                            <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest truncate mt-0.5">
                              {getStaffName((record as any).tested_by)} • {getStaffName((record as any).packed_by)} • {record.condition || 'No Condition'} • {record.sku || 'No SKU'}
                            </div>
                          </div>
                          
                          {/* 3. Order ID */}
                          <div className="flex flex-col w-[94px]">
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-0.5">Order ID</span>
                            <CopyableText 
                              text={record.order_id || ''} 
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
                ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Details Panel - Overlay */}
      <AnimatePresence>
        {selectedShipped && (
          <ShippedDetailsPanel 
            shipped={selectedShipped}
            onClose={handleCloseDetails}
            onUpdate={handleUpdate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
