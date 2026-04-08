'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Database,
  Loader2,
  Plus,
  ShieldCheck,
  X,
} from '@/components/Icons';
import { DashboardShippedSearchHandoffCard } from '@/components/dashboard/DashboardShippedSearchHandoffCard';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabSwitch } from '@/components/ui/TabSwitch';
import { ShippedIntakeForm, type ShippedFormData } from '@/components/shipped';
import { WorkOrderAssignmentCard, type AssignmentConfirmPayload } from '@/components/work-orders/WorkOrderAssignmentCard';
import type { WorkOrderRow } from '@/components/work-orders/types';
import { getPresentStaffForToday } from '@/lib/staffCache';
import { saveWorkOrder } from '@/lib/work-orders/saveWorkOrder';
import { SIDEBAR_GRAY_ASSIGN_BUTTON_CLASS } from '@/components/ui/sidebarPrimaryButtons';
import { sectionLabel, fieldLabel, microBadge } from '@/design-system/tokens/typography/presets';

type PendingStockFilter = 'all' | 'pending' | 'stock';

const PENDING_STOCK_FILTER_TABS = [
  { id: 'all', label: 'All', color: 'blue' as const },
  { id: 'pending', label: 'Pick/Test', color: 'yellow' as const },
  { id: 'stock', label: 'Stock', color: 'red' as const },
];

interface DashboardManagementPanelProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
  showNextUnassignedButton?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onOpenShippedMatches?: (searchQuery: string) => void;
  showPendingFilterControl?: boolean;
  pendingFilterValue?: PendingStockFilter;
  onPendingFilterChange?: (value: PendingStockFilter) => void;
  /** Match dashboard order-view TabSwitch (high contrast for bright / glare-heavy screens). */
  highContrastSliders?: boolean;
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
  onOpenShippedMatches,
  showPendingFilterControl = false,
  pendingFilterValue = 'all',
  onPendingFilterChange,
  highContrastSliders = false,
}: DashboardManagementPanelProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  type TransferPhase = 'idle' | 'fetching' | 'refreshing' | 'done';
  const [transferPhase, setTransferPhase] = useState<TransferPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isTransferring = transferPhase === 'fetching' || transferPhase === 'refreshing';
  const [manualSheetName, setManualSheetName] = useState('');
  const [status, setStatus] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: {
      tabName?: string;
      inserted?: number;
      updated?: number;
      processedRows?: number;
      exceptionsResolved?: number;
      durationMs?: number;
    };
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [assigningState, setAssigningState] = useState<{ rows: WorkOrderRow[]; startIndex: number } | null>(null);
  const [isLoadingAssignment, setIsLoadingAssignment] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [technicianOptions, setTechnicianOptions] = useState<{ id: number; name: string }[]>([]);
  const [packerOptions, setPackerOptions] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => { setIsMounted(true); }, []);

  const handleOpenNextUnassigned = useCallback(async () => {
    setIsLoadingAssignment(true);
    setStatus(null);
    try {
      const [workRes, staffMembers] = await Promise.all([
        fetch('/api/work-orders?queue=all_unassigned'),
        getPresentStaffForToday(),
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
        .filter((member) => member.role === 'technician')
        .map((member) => ({ id: Number(member.id), name: member.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
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
      await saveWorkOrder({
        entityType: row.entityType,
        entityId: row.entityId,
        assignedTechId: newTechId,
        assignedPackerId: newPackerId,
        status: newStatus,
        priority: row.priority,
        deadlineAt: deadline,
        notes: row.notes,
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
    void handleSearch(value);
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

  const handleCancelTransfer = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (elapsedRef.current) clearInterval(elapsedRef.current);
    setTransferPhase('idle');
    setStatus({ type: 'error', message: 'Import cancelled' });
  };

  const handleTransfer = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setTransferPhase('fetching');
    setStatus(null);
    setElapsedMs(0);
    const t0 = Date.now();
    elapsedRef.current = setInterval(() => setElapsedMs(Date.now() - t0), 100);

    try {
      const res = await fetch('/api/google-sheets/transfer-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manualSheetName: manualSheetName.trim() || undefined,
        }),
        signal: controller.signal,
      });
      const data = await res.json();

      if (data.success) {
        setTransferPhase('refreshing');
        const inserted = Number(data.insertedOrders || 0);
        const updated = Number(data.updatedOrdersFields || 0);
        const exceptionsResolved = Number(data.exceptionsResolved || 0);
        const parts = [];
        if (inserted > 0) parts.push(`${inserted} inserted`);
        if (updated > 0) parts.push(`${updated} updated`);
        const message = parts.length > 0 ? `Orders synced: ${parts.join(', ')}` : 'Orders already up to date';
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'], refetchType: 'active' }),
          queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'], refetchType: 'active' }),
          queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'], refetchType: 'active' }),
          queryClient.invalidateQueries({ queryKey: ['shipped-table'], refetchType: 'active' }),
        ]);
        setStatus({
          type: 'success',
          message,
          details: {
            tabName: data.tabName,
            inserted,
            updated,
            processedRows: Number(data.processedRows || 0),
            exceptionsResolved,
            durationMs: Number(data.durationMs || 0),
          },
        });
      } else {
        setStatus({ type: 'error', message: data.error || 'Transfer failed' });
      }
    } catch (_error: any) {
      if (_error?.name === 'AbortError') return;
      setStatus({ type: 'error', message: 'Network error occurred' });
    } finally {
      abortRef.current = null;
      if (elapsedRef.current) clearInterval(elapsedRef.current);
      setTransferPhase('idle');
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
                onClear={() => { setSearchQuery(''); handleSearch(''); }}
                inputRef={searchInputRef}
                placeholder="Search order ID, tracking, SKU, title, customer..."
                variant="blue"
                rightElement={
                  <button
                    type="button"
                    onClick={handleOpenIntakeForm}
                    className="rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-300"
                    title="New Order Entry"
                    aria-label="Open new order entry form"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                }
              />
            </motion.div>
            {showPendingFilterControl ? (
              <motion.div variants={itemVariants} className="-mt-2">
                <TabSwitch
                  tabs={PENDING_STOCK_FILTER_TABS}
                  activeTab={pendingFilterValue}
                  highContrast={highContrastSliders}
                  onTabChange={(tab) => onPendingFilterChange?.(tab === 'stock' ? 'stock' : tab === 'pending' ? 'pending' : 'all')}
                />
              </motion.div>
            ) : null}
            <motion.div variants={itemVariants} className="-mt-2">
              <DashboardShippedSearchHandoffCard
                searchQuery={searchQuery}
                onOpenShippedMatches={onOpenShippedMatches}
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
              <p className={sectionLabel}>Click an order for more details</p>
              <p className={`${fieldLabel} text-gray-500 mt-1`}>Orders are sorted by ship-by date</p>
              <div className="flex flex-col gap-1 mt-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span className={`${fieldLabel} text-gray-500`}>Out of stock</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0" />
                  <span className={`${fieldLabel} text-gray-500`}>Pending pick/test</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className={`${fieldLabel} text-gray-500`}>Tested by tech</span>
                </div>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-4 px-4 pb-4 pt-0 bg-gray-50 rounded-2xl border border-gray-100">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className={`${microBadge} text-gray-500 px-1`}>Manual Sheet Name</label>
                  <input
                    type="text"
                    value={manualSheetName}
                    onChange={(e) => setManualSheetName(e.target.value)}
                    placeholder="e.g., Sheet_01_14_2026"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-[11px] font-mono text-gray-900 outline-none focus:border-blue-500 transition-all"
                    disabled={isTransferring}
                  />
                </div>

                {isTransferring ? (
                  <button
                    onClick={handleCancelTransfer}
                    className={`w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl ${sectionLabel} shadow-lg shadow-red-500/10 transition-all active:scale-95 flex items-center justify-center gap-2`}
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel Import
                  </button>
                ) : (
                  <button
                    onClick={handleTransfer}
                    className={`w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl ${sectionLabel} shadow-lg shadow-blue-600/10 transition-all active:scale-95 flex items-center justify-center gap-2`}
                  >
                    <Database className="w-3.5 h-3.5" />
                    Import Latest Orders
                  </button>
                )}

                {/* Live progress tracker */}
                <AnimatePresence>
                  {isTransferring ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                      className="overflow-hidden"
                    >
                      <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-3 space-y-2.5">
                        {/* Elapsed timer */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                            <span className={`${sectionLabel} text-blue-700`}>
                              {transferPhase === 'refreshing' ? 'Refreshing dashboard' : 'Importing orders'}
                            </span>
                          </div>
                          <motion.span
                            key={Math.floor(elapsedMs / 1000)}
                            initial={{ opacity: 0.5, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-[11px] font-mono font-bold text-blue-500 tabular-nums"
                          >
                            {(elapsedMs / 1000).toFixed(1)}s
                          </motion.span>
                        </div>

                        {/* Animated task descriptions */}
                        <div className="space-y-1">
                          {transferPhase === 'fetching' || transferPhase === 'refreshing' ? (
                            <>
                              {[
                                { threshold: 0, label: 'Connecting to Google Sheets API' },
                                { threshold: 800, label: 'Reading spreadsheet data' },
                                { threshold: 2000, label: 'Matching orders & resolving tracking' },
                                { threshold: 4000, label: 'Syncing changes to database' },
                                { threshold: 6000, label: 'Resolving order exceptions' },
                              ].map(({ threshold, label }, i, arr) => {
                                const nextThreshold = arr[i + 1]?.threshold ?? Infinity;
                                const fetchDone = transferPhase === 'refreshing';
                                const isActive = !fetchDone && elapsedMs >= threshold && elapsedMs < nextThreshold;
                                const isComplete = fetchDone || elapsedMs >= nextThreshold;

                                return (
                                  <motion.div
                                    key={label}
                                    initial={{ opacity: 0, x: -6 }}
                                    animate={{
                                      opacity: elapsedMs >= threshold ? 1 : 0.3,
                                      x: elapsedMs >= threshold ? 0 : -6,
                                    }}
                                    transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                                    className="flex items-center gap-2"
                                  >
                                    <div className="w-4 h-4 flex items-center justify-center shrink-0">
                                      {isComplete ? (
                                        <motion.div
                                          initial={{ scale: 0 }}
                                          animate={{ scale: 1 }}
                                          transition={{ type: 'spring', damping: 12, stiffness: 300 }}
                                        >
                                          <Check className="w-3 h-3 text-blue-600" />
                                        </motion.div>
                                      ) : isActive ? (
                                        <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />
                                      ) : (
                                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                                      )}
                                    </div>
                                    <span className={`text-[10px] font-semibold ${
                                      isActive ? 'text-blue-700' : isComplete ? 'text-blue-500' : 'text-gray-400'
                                    }`}>
                                      {label}
                                    </span>
                                  </motion.div>
                                );
                              })}
                            </>
                          ) : (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="flex items-center gap-2"
                            >
                              <Loader2 className="w-3 h-3 text-blue-600 animate-spin shrink-0" />
                              <span className="text-[10px] font-semibold text-blue-700">Updating dashboard views</span>
                            </motion.div>
                          )}
                        </div>

                        {/* Progress bar */}
                        <div className="h-1 rounded-full bg-blue-100 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-blue-500"
                            initial={{ width: '0%' }}
                            animate={{ width: transferPhase === 'refreshing' ? '95%' : `${Math.min(90, (elapsedMs / 80))}%` }}
                            transition={{ ease: 'easeOut', duration: 0.3 }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {showNextUnassignedButton ? (
                  <button
                    type="button"
                    onClick={handleOpenNextUnassigned}
                    disabled={isLoadingAssignment}
                    className={SIDEBAR_GRAY_ASSIGN_BUTTON_CLASS}
                  >
                    {isLoadingAssignment && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Next Unassigned Order
                  </button>
                ) : null}

              </div>
            </motion.div>

            <AnimatePresence mode="wait">
              {status ? (
                <motion.div
                  key={status.type + status.message}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ type: 'spring', damping: 26, stiffness: 340, mass: 0.5 }}
                  className={`rounded-2xl border overflow-hidden ${
                    status.type === 'success'
                      ? 'bg-emerald-50/80 border-emerald-200/60'
                      : 'bg-red-50/80 border-red-200/60'
                  }`}
                >
                  {/* Header */}
                  <div className={`flex items-center gap-2.5 px-4 py-3 ${
                    status.type === 'success' ? 'text-emerald-700' : 'text-red-700'
                  }`}>
                    <motion.div
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', damping: 14, stiffness: 280, delay: 0.1 }}
                    >
                      {status.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    </motion.div>
                    <div className="min-w-0 flex-1">
                      <p className={sectionLabel}>{status.type === 'success' ? 'Sync Complete' : 'Sync Failed'}</p>
                      <p className="text-[9px] font-medium leading-relaxed opacity-80">{status.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStatus(null)}
                      className="shrink-0 p-1 rounded-lg hover:bg-black/5 transition-colors"
                      aria-label="Dismiss"
                    >
                      <X className="w-3 h-3 opacity-50" />
                    </button>
                  </div>

                  {/* Details breakdown */}
                  {status.type === 'success' && status.details ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      transition={{ type: 'spring', damping: 24, stiffness: 300, delay: 0.15 }}
                      className="border-t border-emerald-200/40"
                    >
                      <div className="px-4 py-3 space-y-2.5">
                        {/* Sheet tab badge */}
                        {status.details.tabName ? (
                          <motion.div
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.2 }}
                            className="flex items-center gap-2"
                          >
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100/80 text-emerald-700">
                              <Database className="w-2.5 h-2.5" />
                              <span className={`${microBadge} text-emerald-700`}>{status.details.tabName}</span>
                            </span>
                            {status.details.durationMs ? (
                              <span className={`${microBadge} text-emerald-500`}>{(status.details.durationMs / 1000).toFixed(1)}s</span>
                            ) : null}
                          </motion.div>
                        ) : null}

                        {/* Stats row */}
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: 'Processed', value: status.details.processedRows ?? 0 },
                            { label: 'Inserted', value: status.details.inserted ?? 0 },
                            { label: 'Updated', value: status.details.updated ?? 0 },
                          ].map((stat, i) => (
                            <motion.div
                              key={stat.label}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.25 + i * 0.05 }}
                              className="text-center rounded-xl bg-white/60 border border-emerald-100/60 py-1.5"
                            >
                              <p className="text-[13px] font-black text-emerald-700 tabular-nums">{stat.value}</p>
                              <p className={`${microBadge} text-emerald-500`}>{stat.label}</p>
                            </motion.div>
                          ))}
                        </div>

                        {/* Exceptions resolved */}
                        {(status.details.exceptionsResolved ?? 0) > 0 ? (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4 }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50/80 border border-blue-100/60"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <p className={`${fieldLabel} text-blue-700`}>
                              <span className="font-black">{status.details.exceptionsResolved}</span> exception{status.details.exceptionsResolved === 1 ? '' : 's'} auto-resolved
                            </p>
                          </motion.div>
                        ) : null}
                      </div>
                    </motion.div>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>
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
