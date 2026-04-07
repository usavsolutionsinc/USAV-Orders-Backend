'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Printer, ExternalLink, ShoppingCart } from '../Icons';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import WeekHeader, { weekDayGroupBandClass, weekDayGroupDateClass, weekDayGroupCountClass } from '../ui/WeekHeader';
import { useWalkInSales } from '@/hooks/useWalkInSales';
import { formatCentsToDollars } from '@/lib/square/client';
import { getSalesWeekRange } from '@/lib/sales-week-range';
import { isRepairSku } from '@/utils/sku';
import { SalesDetailsPanel } from './SalesDetailsPanel';
import type { SquareTransactionRecord } from '@/lib/neon/square-transaction-queries';

export function SalesTable() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.get('search');
  const [selectedSale, setSelectedSale] = useState<SquareTransactionRecord | null>(null);
  const [stickyDate, setStickyDate] = useState('');
  const [currentCount, setCurrentCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Week pagination via URL ──
  const weekOffsetParam = searchParams.get('salesWeekOffset');
  const weekOffset = useMemo(() => {
    if (weekOffsetParam != null) return Math.max(0, parseInt(weekOffsetParam || '0', 10) || 0);
    return 0;
  }, [weekOffsetParam]);
  const weekRange = useMemo(() => getSalesWeekRange(weekOffset), [weekOffset]);

  const setWeekOffsetInUrl = (next: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 0) params.delete('salesWeekOffset');
    else params.set('salesWeekOffset', String(next));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  // ── Data ──
  const { data: sales = [], isLoading: loading } = useWalkInSales(search, {
    weekStart: weekRange.startStr,
    weekEnd: weekRange.endStr,
  });

  const totalRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);

  // ── Date helpers ──
  const getOrdinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const formatDate = useCallback((dateStr: string) => {
    try {
      if (!dateStr) return 'Unknown';
      const date = new Date(dateStr + 'T00:00:00');
      if (isNaN(date.getTime())) return dateStr;
      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      return `${days[date.getDay()]}, ${months[date.getMonth()]} ${getOrdinal(date.getDate())}`;
    } catch { return dateStr; }
  }, []);

  // ── Scroll tracking ──
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
      } else break;
    }
    if (activeDate) setStickyDate(activeDate);
    if (activeCount) setCurrentCount(activeCount);
  }, []);

  useEffect(() => {
    const c = scrollRef.current;
    let t: number | null = null;
    if (c) { c.addEventListener('scroll', handleScroll); t = window.setTimeout(handleScroll, 100); }
    return () => { c?.removeEventListener('scroll', handleScroll); if (t) clearTimeout(t); };
  }, [handleScroll, sales]);

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    router.replace(params.toString() ? `${pathname}?${params}` : pathname);
  };

  // ── Group by date ──
  const grouped: Record<string, SquareTransactionRecord[]> = {};
  sales.forEach((sale) => {
    if (!sale.created_at) return;
    try {
      const date = new Date(sale.created_at).toISOString().split('T')[0];
      if (!grouped[date]) grouped[date] = [];
      grouped[date].push(sale);
    } catch {}
  });

  const flatSales = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).flatMap(([, r]) => r);
  const selectedIndex = selectedSale ? flatSales.findIndex((s) => s.id === selectedSale.id) : -1;

  const getItemsSummary = (sale: SquareTransactionRecord) => {
    const items = Array.isArray(sale.line_items) ? sale.line_items : [];
    if (items.length === 0) return 'No items';
    if (items.length === 1) return items[0].name || '1 item';
    return `${items[0].name || 'Item'} +${items.length - 1} more`;
  };

  // Fallback date for header
  const fallbackDate = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return formatDate(today);
  }, [formatDate]);

  return (
    <div className="flex h-full w-full bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* WeekHeader */}
        <WeekHeader
          stickyDate={stickyDate ? formatDate(stickyDate) : ''}
          fallbackDate={fallbackDate}
          count={currentCount || sales.length}
          weekRange={weekRange}
          weekOffset={weekOffset}
          onPrevWeek={() => setWeekOffsetInUrl(weekOffset + 1)}
          onNextWeek={() => setWeekOffsetInUrl(Math.max(0, weekOffset - 1))}
          leftSlot={
            <div className="flex items-center gap-2">
              {search && (
                <div className="flex items-center gap-2 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">
                  <Search className="w-3 h-3" />
                  <span className="text-[9px] font-black uppercase tracking-widest">{search}</span>
                  <button onClick={clearSearch} className="hover:text-emerald-900 transition-colors" aria-label="Clear search">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
              {selectedSale && (
                <button
                  onClick={() => setSelectedSale(null)}
                  className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all"
                >
                  Close
                </button>
              )}
            </div>
          }
        />

        {/* Sales rows */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-40 gap-3">
              <LoadingSpinner size="lg" className="text-emerald-600" />
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Loading Sales...</p>
            </div>
          ) : sales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {search ? (
                <div className="max-w-xs mx-auto">
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight mb-1">No sales found</h3>
                  <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">
                    No sales matching &ldquo;{search}&rdquo;
                  </p>
                </div>
              ) : (
                <div className="max-w-xs mx-auto">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShoppingCart className="w-8 h-8 text-emerald-300" />
                  </div>
                  <p className="text-sm font-bold text-gray-500">No sales this week</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Use the product catalog in the sidebar to create a sale, or navigate to a previous week
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {Object.entries(grouped)
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([date, records]) => {
                  const dayRevenue = records.reduce((s, r) => s + (r.total || 0), 0);
                  return (
                    <div key={date} className="flex flex-col">
                      <div
                        data-day-header
                        data-date={date}
                        data-count={records.length}
                        className={`${weekDayGroupBandClass} px-3 py-1.5 flex items-center justify-between`}
                      >
                        <p className={weekDayGroupDateClass}>{formatDate(date)}</p>
                        <div className="flex items-center gap-3">
                          <p className={`${weekDayGroupCountClass} text-emerald-600`}>
                            {formatCentsToDollars(dayRevenue)}
                          </p>
                          <p className={weekDayGroupCountClass}>{records.length}</p>
                        </div>
                      </div>
                      {records.map((sale, index) => (
                        <motion.div
                          {...framerPresence.tableRow}
                          transition={framerTransition.tableRowMount}
                          key={sale.id}
                          onClick={() => setSelectedSale(sale)}
                          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedSale(sale); }
                          }}
                          role="button"
                          tabIndex={0}
                          className={`grid grid-cols-[1fr_140px] items-center gap-1 pl-4 pr-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-emerald-50/50 ${
                            selectedSale?.id === sale.id ? 'bg-emerald-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                          }`}
                        >
                          <div className="flex flex-col min-w-0 gap-1">
                            <div className="text-[13px] font-black text-gray-900 truncate leading-tight">
                              {getItemsSummary(sale)}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                              <div className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                (Array.isArray(sale.line_items) && sale.line_items.some((li) => isRepairSku(li.sku)))
                                  ? 'bg-orange-50 text-orange-600 border border-orange-100'
                                  : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                              }`}>
                                {(Array.isArray(sale.line_items) && sale.line_items.some((li) => isRepairSku(li.sku))) ? 'RS' : 'Sale'}
                              </div>
                              <div className="text-[10px] font-black text-emerald-600">
                                {formatCentsToDollars(sale.total)}
                              </div>
                              {sale.customer_name && (
                                <div className="text-[10px] font-bold text-gray-700 truncate">
                                  {sale.customer_name}
                                </div>
                              )}
                              {sale.notes && (
                                <div className="text-[9px] text-gray-400 truncate">{sale.notes}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex w-full items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => window.open(`/api/walk-in/receipt/${sale.id}`, '_blank', 'noopener,noreferrer')}
                              className="p-1.5 bg-gray-50 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 rounded-lg transition-all"
                              title="Print receipt"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                            {sale.receipt_url && (
                              <button
                                onClick={() => window.open(sale.receipt_url!, '_blank', 'noopener,noreferrer')}
                                className="p-1.5 bg-gray-50 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-all"
                                title="View Square receipt"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedSale && (
          <SalesDetailsPanel
            sale={selectedSale}
            onClose={() => setSelectedSale(null)}
            onMoveUp={() => { if (selectedIndex > 0) setSelectedSale(flatSales[selectedIndex - 1]); }}
            onMoveDown={() => { if (selectedIndex < flatSales.length - 1) setSelectedSale(flatSales[selectedIndex + 1]); }}
            disableMoveUp={selectedIndex <= 0}
            disableMoveDown={selectedIndex >= flatSales.length - 1}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
