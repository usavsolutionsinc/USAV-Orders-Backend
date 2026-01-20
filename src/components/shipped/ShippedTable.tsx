'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search, X, Copy, Check, AlertTriangle } from '../Icons';
import { ShippedRecord } from '@/lib/neon/shipped-queries';
import { ShippedDetailsPanel } from './ShippedDetailsPanel';

// Copyable text component like tech pages
const CopyableText = ({ text, className, disabled = false, isSerial = false }: { text: string; className?: string; disabled?: boolean; isSerial?: boolean }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text || disabled || text === '---') return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Show last 10 digits for serial numbers, last 8 for tracking
  const displayText = isSerial 
    ? (text.length > 10 ? text.slice(-10) : text)
    : (text.length > 8 ? text.slice(-8) : text);
  const isEmpty = !text || text === '---' || disabled;

  if (isEmpty) {
    return (
      <div className={`${className} flex items-center justify-center w-full opacity-40`}>
        <span className="text-left w-full">---</span>
      </div>
    );
  }

  return (
    <button 
      onClick={handleCopy}
      className={`${className} group relative flex items-center justify-between gap-1 hover:brightness-95 active:scale-95 transition-all w-full`}
      title={`Click to copy: ${text}`}
    >
      <span className="truncate flex-1 text-left">{displayText}</span>
      {copied ? <Check className="w-2 h-2" /> : <Copy className="w-2 h-2 opacity-0 group-hover:opacity-40 transition-opacity" />}
    </button>
  );
};

export function ShippedTable() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search');
  const [shipped, setShipped] = useState<ShippedRecord[]>([]);
  const [selectedShipped, setSelectedShipped] = useState<ShippedRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const limit = 50;

  useEffect(() => {
    fetchShipped(true);
  }, [search]);

  const fetchShipped = async (reset = false) => {
    try {
      if (reset) {
        setLoading(true);
        setOffset(0);
        setHasMore(true);
      }
      
      const url = search 
        ? `/api/shipped/search?q=${encodeURIComponent(search)}`
        : `/api/shipped?limit=${limit}&offset=${reset ? 0 : offset}`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (search) {
        setShipped(data.results || []);
        setHasMore(false);
      } else {
        const newRecords = data.shipped || [];
        if (reset) {
          setShipped(newRecords);
        } else {
          setShipped(prev => [...prev, ...newRecords]);
        }
        if (newRecords.length < limit) {
          setHasMore(false);
        }
      }
    } catch (error) {
      console.error('Error fetching shipped records:', error);
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || search) return;
    
    setIsLoadingMore(true);
    const nextOffset = offset + limit;
    setOffset(nextOffset);
    
    try {
      const res = await fetch(`/api/shipped?limit=${limit}&offset=${nextOffset}`);
      const data = await res.json();
      const newRecords = data.shipped || [];
      
      if (newRecords.length < limit) setHasMore(false);
      if (newRecords.length > 0) {
        setShipped(prev => [...prev, ...newRecords]);
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error("Failed to load more:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [offset, hasMore, isLoadingMore, search]);

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
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    
    if (scrollHeight - scrollTop <= clientHeight + 100) {
      loadMore();
    }

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
  }, [loadMore]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll();
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, shipped]);

  const handleRowClick = (record: ShippedRecord) => {
    setSelectedShipped(record);
  };

  const handleCloseDetails = () => {
    setSelectedShipped(null);
  };

  const handleUpdate = () => {
    fetchShipped(true);
  };

  // Group records by date
  const groupedShipped: { [key: string]: ShippedRecord[] } = {};
  shipped.forEach(record => {
    if (!record.date_time) return;
    
    let date = '';
    try {
      const dateObj = new Date(record.date_time);
      date = dateObj.toISOString().split('T')[0];
    } catch (e) {
      date = 'Unknown';
    }
    
    if (!groupedShipped[date]) groupedShipped[date] = [];
    groupedShipped[date].push(record);
  });

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
              Count: {currentCount || shipped.length}
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar w-full">
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
            <div className="flex flex-col">
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
                      const hasAlert = record.date_time === '1';
                      const ts = record.date_time;
                      return (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          key={record.id}
                          onClick={() => handleRowClick(record)}
                          className={`grid grid-cols-[55px_80px_80px_1fr_80px] items-center gap-1 px-1 py-1 transition-colors border-b border-gray-50/50 cursor-pointer hover:bg-blue-50/80 ${
                            selectedShipped?.id === record.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                          }`}
                        >
                          {/* Time on left */}
                          <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left flex items-center gap-1">
                            {hasAlert && <AlertTriangle className="w-3 h-3 text-red-600 animate-pulse" />}
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
                          
                          {/* Tracking Number - Blue background */}
                          <CopyableText 
                            text={record.shipping_tracking_number || ''} 
                            className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50/30 px-1 py-0.5 rounded border border-blue-100/30"
                            isSerial={false}
                          />
                          
                          {/* Serial Number - Green background */}
                          <CopyableText 
                            text={record.serial_number || ''} 
                            className="text-[11px] font-mono font-bold text-emerald-600 bg-emerald-50/30 px-1 py-0.5 rounded border border-emerald-100/30"
                            isSerial={true}
                          />
                          
                          {/* Product Title */}
                          <div className="text-[11px] font-bold text-gray-900 truncate text-left">
                            {record.product_title || 'Unknown Product'}
                          </div>
                          
                          {/* Condition */}
                          <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest text-left truncate opacity-60">
                            {record.condition || ''}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                ))}
              
              {isLoadingMore && (
                <div className="py-8 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                </div>
              )}
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
