'use client';

import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X, Printer, DollarSign } from '../Icons';
import { SourceOrderChip, TicketChip } from '../ui/CopyChip';
import { RSRecord, type RepairTab } from '@/lib/neon/repair-service-queries';
import { RepairDetailsPanel } from './RepairDetailsPanel';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useRepairs } from '@/hooks/useRepairs';

// Format phone number to 000-000-0000
const formatPhoneNumber = (phone: string): string => {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

interface RepairTableProps {
  filter: RepairTab;
}

export function RepairTable({ filter }: RepairTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.get('search');
  const [selectedRepair, setSelectedRepair] = useState<RSRecord | null>(null);
  const [stickyDate, setStickyDate] = useState<string>('');
  const [currentCount, setCurrentCount] = useState<number>(0);
  const [payingRepairId, setPayingRepairId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: repairs = [], isLoading: loading } = useRepairs(search, filter);

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
    let timeoutId: number | null = null;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      timeoutId = window.setTimeout(() => handleScroll(), 100);
    }
    return () => {
      container?.removeEventListener('scroll', handleScroll);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [handleScroll, repairs]);

  const handleRowClick = (repair: RSRecord) => setSelectedRepair(repair);
  const handleCloseDetails = () => setSelectedRepair(null);

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const getLast4 = (value: string | null | undefined) => {
    const raw = String(value || '');
    return raw.length > 4 ? raw.slice(-4) : raw || '---';
  };

  const parsePriceToMinorUnits = (value: string | null | undefined): number | null => {
    const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const amount = Math.round(parsed * 100);
    return amount > 0 ? amount : null;
  };

  const getRepairSourceSku = (repair: RSRecord): string =>
    String(repair.source_sku || '').trim();

  const canCreateSquarePayment = (repair: RSRecord): boolean =>
    Boolean(getRepairSourceSku(repair)) || parsePriceToMinorUnits(repair.price) !== null;

  const openSquarePayment = async (repair: RSRecord) => {
    if (payingRepairId === repair.id) return;
    const sourceSku = getRepairSourceSku(repair);
    const amount = parsePriceToMinorUnits(repair.price);
    if (!sourceSku && amount === null) {
      window.alert('Add a source SKU or set a valid repair price before creating a Square payment link.');
      return;
    }

    const pendingWindow = window.open('', '_blank');
    setPayingRepairId(repair.id);

    try {
      const response = await fetch('/api/repair/square-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repairId: repair.id,
          sourceSku: sourceSku || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        paymentUrl?: string;
        error?: string;
      };

      if (!response.ok || !payload.success || !payload.paymentUrl) {
        throw new Error(payload.error || 'Failed to create Square payment link');
      }

      if (pendingWindow) {
        pendingWindow.location.href = payload.paymentUrl;
      } else {
        window.open(payload.paymentUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
      const message = error instanceof Error ? error.message : 'Failed to open Square checkout';
      window.alert(message);
    } finally {
      setPayingRepairId((current) => (current === repair.id ? null : current));
    }
  };

  const filteredRepairs = repairs;

  const groupedRepairs: { [key: string]: RSRecord[] } = {};
  filteredRepairs.forEach(record => {
    if (!record.created_at) return;
    let date = '';
    try {
      date = new Date(record.created_at).toISOString().split('T')[0];
    } catch (e) { date = 'Unknown'; }
    if (!groupedRepairs[date]) groupedRepairs[date] = [];
    groupedRepairs[date].push(record);
  });

  const getTodayCount = () => {
    const today = new Date().toISOString().split('T')[0];
    return groupedRepairs[today]?.length || 0;
  };

  // Flat sorted list matching the render order (oldest date first, same order as groups)
  const flatRepairs = Object.entries(groupedRepairs)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([, records]) => records);

  const selectedIndex = selectedRepair
    ? flatRepairs.findIndex((r) => r.id === selectedRepair.id)
    : -1;

  const handleMoveUp = () => {
    if (selectedIndex > 0) setSelectedRepair(flatRepairs[selectedIndex - 1]);
  };

  const handleMoveDown = () => {
    if (selectedIndex < flatRepairs.length - 1) setSelectedRepair(flatRepairs[selectedIndex + 1]);
  };

  return (
    <div className="flex h-full w-full bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={mainStickyHeaderClass}>
          <div className={mainStickyHeaderRowClass}>
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
                  onClick={clearSearch}
                  className="hover:text-orange-900 transition-colors"
                  aria-label="Clear search filter"
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
        </div>

        {/* Table Content */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-40 gap-3 text-gray-400">
              <LoadingSpinner size="lg" className="text-blue-600" />
              <p className="text-[10px] font-black uppercase tracking-widest">Loading Repairs...</p>
            </div>
          ) : filteredRepairs.length === 0 ? (
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
                .sort((a, b) => a[0].localeCompare(b[0]))
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
                        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleRowClick(repair);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selectedRepair?.id === repair.id}
                        aria-label={`Open repair details for ${repair.product_title || `record ${repair.id}`}`}
                        className={`grid grid-cols-[1fr_220px] items-center gap-1 pl-4 pr-4 py-3 transition-all border-b border-gray-50 cursor-pointer hover:bg-blue-50/50 ${
                          selectedRepair?.id === repair.id ? 'bg-blue-50/80' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/10'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 gap-1">
                          <div className="text-[13px] font-black text-gray-900 truncate leading-tight">
                            {repair.product_title || 'Unknown Product'}
                          </div>
                          <div className="text-[11px] font-black text-gray-700 truncate leading-tight">
                            {repair.issue || repair.source_tracking_number || 'No issue specified'}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <div className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                              {repair.price ? `$${repair.price}` : '---'}
                            </div>
                            <div className="text-[10px] font-black text-gray-700 truncate uppercase tracking-tight">
                              {(() => {
                                if (!repair.contact_info) return 'No Name';
                                const parts = repair.contact_info.split(',').map((p: string) => p.trim());
                                return parts[0] || 'No Name';
                              })()}
                            </div>
                            <div className="text-[9px] font-bold text-gray-500 truncate">
                              {(() => {
                                if (!repair.contact_info) return '';
                                const parts = repair.contact_info.split(',').map((p: string) => p.trim());
                                return formatPhoneNumber(parts[1] || '');
                              })()}
                            </div>
                            <div className="text-[8px] font-bold text-gray-900 lowercase truncate">
                              {repair.source_tracking_number || (() => {
                                if (!repair.contact_info) return '';
                                const parts = repair.contact_info.split(',').map((p: string) => p.trim());
                                return parts[2] || '';
                              })()}
                            </div>
                          </div>
                        </div>
                        <div className="flex w-full items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col items-start shrink-0">
                            <SourceOrderChip
                              value={String(repair.source_order_id || '').trim() || 'WALK-IN'}
                              display={String(repair.source_order_id || '').trim() ? getLast4(repair.source_order_id) : 'WALK-IN'}
                              disableCopy={!String(repair.source_order_id || '').trim()}
                            />
                          </div>
                          <div className="flex flex-col items-start shrink-0">
                            <TicketChip
                              value={repair.ticket_number || ''}
                              display={getLast4(repair.ticket_number)}
                            />
                          </div>
                          <button
                            onClick={() => window.open(`/api/repair-service/print/${repair.id}`, '_blank', 'noopener,noreferrer')}
                            className="p-1.5 bg-gray-50 hover:bg-orange-50 text-gray-400 hover:text-orange-600 rounded-lg transition-all"
                            title="Print Repair Form"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void openSquarePayment(repair)}
                            disabled={!canCreateSquarePayment(repair) || payingRepairId === repair.id}
                            className="p-1.5 bg-gray-50 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            title={
                              !canCreateSquarePayment(repair)
                                ? 'Set source SKU or valid price to enable Square payment'
                                : getRepairSourceSku(repair)
                                  ? 'Create Square payment link from matching catalog SKU'
                                  : 'Create Square payment link (price fallback)'
                            }
                          >
                            <DollarSign className={`w-3.5 h-3.5 ${payingRepairId === repair.id ? 'animate-pulse' : ''}`} />
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
            onUpdate={handleCloseDetails}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            disableMoveUp={selectedIndex <= 0}
            disableMoveDown={selectedIndex >= flatRepairs.length - 1}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
