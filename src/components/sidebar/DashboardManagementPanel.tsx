'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  Database,
  Loader2,
  Plus,
  X,
} from '@/components/Icons';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SearchBar } from '@/components/ui/SearchBar';
import { ShippedIntakeForm, type ShippedFormData } from '@/components/shipped';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { getActiveStaff } from '@/lib/staffCache';

interface DashboardManagementPanelProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  showNextUnassignedButton?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

interface SearchHistory {
  query: string;
  timestamp: Date;
  resultCount?: number;
}

export function DashboardManagementPanel({
  showIntakeForm = false,
  onCloseForm,
  onFormSubmit,
  filterControl,
  showNextUnassignedButton = false,
  searchValue = '',
  onSearchChange,
}: DashboardManagementPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isTransferring, setIsTransferring] = useState(false);
  const [manualSheetName, setManualSheetName] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [assigningState, setAssigningState] = useState<{ rows: WorkOrderRow[]; startIndex: number } | null>(null);
  const [isLoadingAssignment, setIsLoadingAssignment] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<{ id: number; name: string }[]>([]);
  const [packerOptions, setPackerOptions] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => { setIsMounted(true); }, []);

  const TECH_IDS = [1, 2, 3, 6];

  const handleOpenNextUnassigned = useCallback(async () => {
    setIsLoadingAssignment(true);
    setStatus(null);
    try {
      const [workRes, staffMembers] = await Promise.all([
        fetch('/api/work-orders?queue=all_unassigned', { cache: 'no-store' }),
        getActiveStaff(),
      ]);
      const workJson = workRes.ok ? await workRes.json() : {};
      const rows: WorkOrderRow[] = Array.isArray(workJson?.rows)
        ? workJson.rows.filter((row: WorkOrderRow) => row.entityType === 'ORDER')
        : [];

      if (!rows.length) {
        setStatus({ type: 'success', message: 'No unassigned orders found.' });
        return;
      }
      const techs = staffMembers
        .filter((member) => member.role === 'technician' && TECH_IDS.includes(Number(member.id)))
        .map((member) => ({ id: Number(member.id), name: member.name }))
        .sort((a, b) => TECH_IDS.indexOf(a.id) - TECH_IDS.indexOf(b.id));
      const packers = staffMembers
        .filter((member) => member.role === 'packer')
        .map((member) => ({ id: Number(member.id), name: member.name }));
      setTechnicianOptions(techs);
      setPackerOptions(packers);
      setAssigningState({ rows, startIndex: 0 });
    } catch {
      setStatus({ type: 'error', message: 'Failed to load unassigned orders.' });
    } finally {
      setIsLoadingAssignment(false);
    }
  }, []);

  const handleAssignConfirm = useCallback(async (row: WorkOrderRow, payload: AssignmentConfirmPayload) => {
    const { techId: newTechId, packerId: newPackerId, deadline, status: statusOverride } = payload;
    const newStatus =
      statusOverride ??
      (newTechId && newPackerId && row.status === 'OPEN' ? 'ASSIGNED' : row.status);
    try {
      await fetch('/api/work-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: row.entityType,
          entityId: row.entityId,
          assignedTechId: newTechId,
          assignedPackerId: newPackerId,
          status: newStatus,
          priority: row.priority,
          deadlineAt: deadline,
          notes: row.notes,
        }),
      });
      window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    } catch {
      // Silent — the card already optimistically updated; a full refresh will reconcile.
    }
  }, []);

  useEffect(() => {
    setSearchQuery(searchValue);
  }, [searchValue]);

  useEffect(() => {
    const focusSearchInput = () => {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    };

    const handleFocusSearch = () => {
      focusSearchInput();
    };

    window.addEventListener('dashboard-focus-search' as any, handleFocusSearch as any);

    try {
      const shouldFocus = sessionStorage.getItem('dashboard-focus-search') === '1';
      if (shouldFocus) {
        sessionStorage.removeItem('dashboard-focus-search');
        focusSearchInput();
      }
    } catch (_error) {
      // no-op
    }

    return () => {
      window.removeEventListener('dashboard-focus-search' as any, handleFocusSearch as any);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dashboard_search_history');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setSearchHistory(
        parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }))
      );
    } catch (_error) {
      setSearchHistory([]);
    }
  }, []);

  const saveSearchHistory = (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const newHistory = [
      { query: trimmedQuery, timestamp: new Date() },
      ...searchHistory.filter((h) => h.query !== trimmedQuery).slice(0, 4),
    ];
    setSearchHistory(newHistory);
    localStorage.setItem('dashboard_search_history', JSON.stringify(newHistory));
  };

  const handleSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      saveSearchHistory(trimmedQuery);
    }
    await onSearchChange?.(trimmedQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSearchChange]);

  const handleInputChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleSearch(value);
    }, 400);
  }, [handleSearch]);

  const clearSearchHistory = () => {
    setSearchHistory([]);
    setShowAllSearchHistory(false);
    localStorage.removeItem('dashboard_search_history');
  };

  const handleOpenIntakeForm = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('new', 'true');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `${pathname || '/dashboard'}?${nextSearch}` : pathname || '/dashboard');
  };

  const handleTransfer = async () => {
    setIsTransferring(true);
    setStatus(null);
    try {
      const res = await fetch('/api/google-sheets/transfer-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manualSheetName: manualSheetName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const inserted = Number(data.insertedOrders || 0);
        const updated = Number(data.updatedOrdersFields || 0);
        const parts = [];
        if (inserted > 0) parts.push(`${inserted} inserted`);
        if (updated > 0) parts.push(`${updated} updated`);
        const message = parts.length > 0 ? `Orders table synced: ${parts.join(', ')}` : 'Orders table already up to date';
        setStatus({ type: 'success', message });
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      } else {
        setStatus({ type: 'error', message: data.error || 'Transfer failed' });
      }
    } catch (_error) {
      setStatus({ type: 'error', message: 'Network error occurred' });
    } finally {
      setIsTransferring(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
    visible: {
      opacity: 1,
      x: 0,
      filter: 'blur(0px)',
      transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
    },
  };

  if (showIntakeForm) {
    return <ShippedIntakeForm onClose={onCloseForm || (() => {})} onSubmit={onFormSubmit || (() => {})} />;
  }

  const visibleSearchHistory = showAllSearchHistory ? searchHistory : searchHistory.slice(0, 3);
  return (
    <>
      <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden">
        {filterControl ? (
          <motion.div variants={itemVariants} className="relative z-20">
            {filterControl}
          </motion.div>
        ) : null}
        <div className={`h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide px-6 pb-6 ${filterControl ? 'pt-4' : 'pt-6'}`}>
          <div className="space-y-4">
            <motion.div variants={itemVariants}>
              <SearchBar
                value={searchQuery}
                onChange={handleInputChange}
                onSearch={handleSearch}
                onClear={() => { setSearchQuery(''); handleSearch(''); }}
                inputRef={searchInputRef}
                placeholder="Search order ID, tracking, SKU, title, customer..."
                variant="blue"
                rightElement={
                  <button
                    type="button"
                    onClick={handleOpenIntakeForm}
                    className="p-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                    title="New Order Entry"
                    aria-label="Open new order entry form"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                }
              />
            </motion.div>
            <motion.div variants={itemVariants} className="-mt-1">
              <RecentSearchesList
                items={visibleSearchHistory}
                totalCount={searchHistory.length}
                expanded={showAllSearchHistory}
                onToggleExpanded={() => setShowAllSearchHistory((current) => !current)}
                onClear={clearSearchHistory}
                onSelect={(query) => {
                  setSearchQuery(query);
                  handleSearch(query);
                }}
              />
            </motion.div>
            <motion.div variants={itemVariants} className="-mt-1 text-left">
              <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Click an order for more details</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-1">Orders are sorted by ship-by date</p>
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Out of stock</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Pending pick/test</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tested by tech</span>
                </div>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-4 px-4 pb-4 pt-0 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-gray-500 uppercase px-1 tracking-widest">Manual Sheet Name</label>
                  <input
                    type="text"
                    value={manualSheetName}
                    onChange={(e) => setManualSheetName(e.target.value)}
                    placeholder="e.g., Sheet_01_14_2026"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-[11px] font-mono text-gray-900 outline-none focus:border-blue-500 transition-all"
                    disabled={isTransferring}
                  />
                </div>

                <button
                  onClick={handleTransfer}
                  disabled={isTransferring}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-600/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {isTransferring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                  Import Latest Orders
                </button>

                {showNextUnassignedButton ? (
                  <button
                    type="button"
                    onClick={handleOpenNextUnassigned}
                    disabled={isLoadingAssignment}
                    className="w-full py-3 bg-gray-900 hover:bg-black disabled:bg-gray-400 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    {isLoadingAssignment && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Next Unassigned Order
                  </button>
                ) : null}

              </div>
            </motion.div>

            {status ? (
              <motion.div
                variants={itemVariants}
                className={`p-4 rounded-2xl border ${
                  status.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'
                } flex items-start gap-3`}
              >
                {status.type === 'success' ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <X className="w-4 h-4 mt-0.5 shrink-0" />}
                <div className="space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest">{status.type === 'success' ? 'Success' : 'Error'}</p>
                  <p className="text-[9px] font-medium leading-relaxed">{status.message}</p>
                </div>
              </motion.div>
            ) : null}
          </div>

          <motion.footer variants={itemVariants} className="mt-auto pt-4 border-t border-gray-100 opacity-30 text-center">
            <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV INFRASTRUCTURE</p>
          </motion.footer>
        </div>
      </motion.div>

      {isMounted && assigningState && createPortal(
        <AnimatePresence>
          <WorkOrderAssignmentCard
            rows={assigningState.rows}
            startIndex={assigningState.startIndex}
            technicianOptions={technicianOptions}
            packerOptions={packerOptions}
            onConfirm={handleAssignConfirm}
            onClose={() => setAssigningState(null)}
          />
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
