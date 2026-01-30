'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search, X, Printer, Info, AlertTriangle } from '../Icons';
import { CopyableText } from '../ui/CopyableText';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { RepairDetailsPanel } from './RepairDetailsPanel';
import { LoadingSpinner } from '../ui/LoadingSpinner';

// Format phone number to 000-000-0000
const formatPhoneNumber = (phone: string): string => {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

const STATUS_OPTIONS = [
  'Awaiting Parts',
  'Pending Repair',
  'Awaiting Pickup',
  'Repaired, Contact Customer',
  'Awaiting Payment',
  'Awaiting Additional Parts Payment',
  'Shipped',
  'Picked Up'
];

export function RepairTable() {
  const searchParams = useSearchParams();
  const search = searchParams.get('search');
  const [repairs, setRepairs] = useState<RSRecord[]>([]);
  const [selectedRepair, setSelectedRepair] = useState<RSRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState<number | null>(null);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRepairs();
  }, [search]);

  const fetchRepairs = async () => {
    try {
      setLoading(true);
      const url = search 
        ? `/api/repair-service?q=${encodeURIComponent(search)}`
        : '/api/repair-service';
      const res = await fetch(url);
      const data = await res.json();
      setRepairs(data.repairs || []);
    } catch (error) {
      console.error('Error fetching repairs:', error);
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
    } catch (e) { return dateStr; }
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
      setTimeout(() => handleScroll(), 100);
    }
    return () => container?.removeEventListener('scroll', handleScroll);
  }, [handleScroll, repairs]);

  const handleStatusChange = async (id: number, newStatus: string) => {
    setRepairs(prev => prev.map(r => 
      r.id === id ? { ...r, status: newStatus } : r
    ));
    setUpdatingStatus(id);
    try {
      const res = await fetch('/api/repair-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      await fetchRepairs();
    } catch (error) {
      console.error('Error updating status:', error);
      fetchRepairs();
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleRowClick = (repair: RSRecord) => {
    setSelectedRepair(repair);
  };

  const handleCloseDetails = () => {
    setSelectedRepair(null);
  };

  const handleUpdate = () => {
    fetchRepairs();
  };

  // Group records by date
  const groupedRepairs: { [key: string]: RSRecord[] } = {};
  repairs.forEach(record => {
    if (!record.date_time) return;
    let date = '';
    try {
      const dateObj = new Date(record.date_time);
      date = dateObj.toISOString().split('T')[0];
    } catch (e) { date = 'Unknown'; }
    if (!groupedRepairs[date]) groupedRepairs[date] = [];
    groupedRepairs[date].push(record);
  });

  const getTodayCount = () => {
    const today = new Date().toISOString().split('T')[0];
    return groupedRepairs[today]?.length || 0;
  };

  return (
    <div className="flex h-full w-full bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
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
          <div className="flex items-center gap-2">
            {search && (
              <div className="flex items-center gap-2 px-2 py-0.5 bg-orange-50 text-orange-700 rounded-lg border border-orange-100">
                <Search className="w-3 h-3" />
                <span className="text-[9px] font-black uppercase tracking-widest">{search}</span>
                <button 
                  onClick={() => window.history.pushState({}, '', '/repair')}
                  className="hover:text-orange-900 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
            {selectedRepair && (
              <button 
                onClick={() => setSelectedRepair(null)}
                className="flex items-center gap-2 px-3 py-1 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
              >
                Close Panel
              </button>
            )}
          </div>
        </div>
        
        {/* Table Content */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-40 gap-3 text-gray-400">
              <LoadingSpinner size="lg" className="text-blue-600" />
              <p className="text-[10px] font-black uppercase tracking-widest">Loading Repairs...</p>
            </div>
          ) : repairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {search ? (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">Repair not found</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                    We couldn't find any repairs matching "{search}"
                  </p>
                </div>
              ) : (
                <p className="text-gray-500 font-medium italic opacity-20">No repairs found</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(groupedRepairs)
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
                    {records.map((repair, index) => (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        key={repair.id}
                        onClick={() => handleRowClick(repair)}
                        className={`grid grid-cols-[60px_2fr_1fr_94px_80px_140px_80px] items-center gap-3 px-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                          selectedRepair?.id === repair.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                        }`}
                      >
                        {/* 1. Time */}
                        <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left">
                          {repair.date_time ? (
                            (() => {
                              try {
                                const dateObj = new Date(repair.date_time);
                                return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                              } catch {
                                return '--:--';
                              }
                            })()
                          ) : '--:--'}
                        </div>
                        
                        {/* 2. Product Title, Name, Phone & Email */}
                        <div className="flex flex-col min-w-0 gap-1">
                          {/* Product Title - Large */}
                          <div className="text-[13px] font-black text-gray-900 truncate leading-tight">
                            {repair.product_title || 'Unknown Product'}
                          </div>
                          
                          {/* Customer Name, Phone & Email - All on one line */}
                          <div className="flex items-center gap-3 mt-0.5">
                            <div className="text-[10px] font-black text-gray-700 truncate uppercase tracking-tight">
                              {(() => {
                                if (!repair.contact_info) return 'No Name';
                                const parts = repair.contact_info.split(',').map(p => p.trim());
                                return parts[0] || 'No Name';
                              })()}
                            </div>
                            <div className="text-[9px] font-bold text-gray-500 truncate">
                              {(() => {
                                if (!repair.contact_info) return '';
                                const parts = repair.contact_info.split(',').map(p => p.trim());
                                return formatPhoneNumber(parts[1] || '');
                              })()}
                            </div>
                            <div className="text-[8px] font-bold text-gray-900 lowercase truncate">
                              {(() => {
                                if (!repair.contact_info) return '';
                                const parts = repair.contact_info.split(',').map(p => p.trim());
                                return parts[2] || '';
                              })()}
                            </div>
                          </div>
                        </div>
                        
                        {/* 3. Issue */}
                        <div className="flex flex-col min-w-0 justify-center">
                          <div className="text-[13px] font-black text-gray-900 truncate leading-tight">
                            {repair.issue || 'No issue specified'}
                          </div>
                        </div>
                        
                        {/* 4. Ticket # (Copyable) */}
                        <div className="flex flex-col w-[94px]">
                          <span className="text-[8px] font-black text-gray-400 uppercase tracking-tighter mb-0.5">Ticket #</span>
                          <CopyableText 
                            text={repair.ticket_number || ''} 
                            className="text-[10px] font-mono font-bold text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100"
                            variant="default"
                          />
                        </div>
                        
                        {/* 5. Price */}
                        <div className="flex flex-col">
                          <span className="text-[8px] font-black text-emerald-400 uppercase tracking-tighter mb-0.5">Price</span>
                          <div className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                            {repair.price ? `$${repair.price}` : '---'}
                          </div>
                        </div>
                        
                        {/* 6. Status Dropdown */}
                        <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[8px] font-black text-blue-400 uppercase tracking-tighter mb-0.5">Status</span>
                          <select
                            value={repair.status || ''}
                            onChange={(e) => handleStatusChange(repair.id, e.target.value)}
                            disabled={updatingStatus === repair.id}
                            className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg border transition-all outline-none focus:ring-4 focus:ring-blue-500/10 ${
                              repair.status === 'Shipped' || repair.status === 'Picked Up'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : repair.status?.includes('Awaiting')
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : 'bg-blue-50 border-blue-200 text-blue-700'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="">Status...</option>
                            {STATUS_OPTIONS.map(status => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </div>
                        
                        {/* 7. Actions */}
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleRowClick(repair)}
                            className={`p-1.5 rounded-lg transition-all ${
                              selectedRepair?.id === repair.id 
                                ? 'bg-blue-600 text-white' 
                                : 'bg-gray-50 text-gray-400 hover:bg-blue-50 hover:text-blue-600'
                            }`}
                            title="View Details"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => window.open(`/api/repair-service/print/${repair.id}`, '_blank')}
                            className="p-1.5 bg-gray-50 hover:bg-orange-50 text-gray-400 hover:text-orange-600 rounded-lg transition-all"
                            title="Print Repair Form"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
      
      <AnimatePresence>
        {selectedRepair && (
          <RepairDetailsPanel 
            repair={selectedRepair}
            onClose={handleCloseDetails}
            onUpdate={handleUpdate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
