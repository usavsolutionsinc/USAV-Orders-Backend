'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { Loader2, Search, X, Printer, Info, AlertTriangle } from '../Icons';
import { CopyableText } from '../ui/CopyableText';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { RepairDetailsPanel } from './RepairDetailsPanel';
import { LoadingSpinner } from '../ui/LoadingSpinner';

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
            <div className="flex flex-col min-w-max">
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
                    <table className="w-full border-collapse">
                      <thead className="bg-gray-50/50 border-b border-gray-100 sticky top-0 z-10 sr-only">
                        <tr>
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Date/Time</th>
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Ticket #</th>
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Contact</th>
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Product(s)</th>
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Price</th>
                          <th className="px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Status</th>
                          <th className="px-4 py-2 text-center text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {records.map((repair, index) => (
                          <motion.tr 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            key={repair.id}
                            onClick={() => handleRowClick(repair)}
                            className={`group hover:bg-blue-50/50 cursor-pointer transition-all duration-200 ${
                              selectedRepair?.id === repair.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                            }`}
                          >
                            <td className="px-4 py-4 text-[11px] font-bold text-gray-500 whitespace-nowrap tabular-nums">
                              {repair.date_time ? new Date(repair.date_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'}
                            </td>
                            <td className="px-4 py-4">
                              <CopyableText 
                                text={repair.ticket_number || ''} 
                                className="text-[11px] font-black font-mono text-gray-900 bg-gray-100/50 px-2 py-1 rounded-lg border border-gray-200/50"
                                variant="default"
                              />
                            </td>
                            <td className="px-4 py-4">
                              <div className="max-w-[150px] truncate text-[11px] font-bold text-gray-700">
                                {repair.contact || '---'}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="max-w-[200px] truncate text-[11px] font-black text-gray-900" title={repair.product_title}>
                                {repair.product_title || '---'}
                              </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <span className="text-[11px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                                {repair.price ? `$${repair.price}` : '---'}
                              </span>
                            </td>
                            <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                              <select
                                value={repair.status || ''}
                                onChange={(e) => handleStatusChange(repair.id, e.target.value)}
                                disabled={updatingStatus === repair.id}
                                className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-xl border transition-all outline-none focus:ring-4 focus:ring-blue-500/10 ${
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
                            </td>
                            <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => handleRowClick(repair)}
                                  className={`p-2 rounded-lg transition-all ${
                                    selectedRepair?.id === repair.id 
                                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
                                      : 'bg-gray-100 text-gray-400 hover:bg-blue-50 hover:text-blue-600'
                                  }`}
                                  title="View Details"
                                >
                                  <Info className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => window.open(`/api/repair-service/print/${repair.id}`, '_blank')}
                                  className="p-2 bg-gray-100 hover:bg-orange-50 text-gray-400 hover:text-orange-600 rounded-lg transition-all"
                                  title="Print Repair Form"
                                >
                                  <Printer className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
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
