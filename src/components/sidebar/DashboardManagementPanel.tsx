'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
} from '@/design-system/foundations/motion-framer';
import { useMotionTransition } from '@/design-system/foundations/motion-framer-hooks';
import {
  AlertTriangle,
  Box,
  Check,
  Database,
  Layout,
  Loader2,
  Plus,
  ShieldCheck,
  Tool,
  X,
} from '@/components/Icons';
import { DashboardShippedSearchHandoffCard } from '@/components/dashboard/DashboardShippedSearchHandoffCard';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { SearchBar } from '@/components/ui/SearchBar';
import { sidebarHeaderPillRowClass, sidebarHeaderRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { ShippedIntakeForm, type ShippedFormData } from '@/components/shipped';
import { sectionLabel, fieldLabel, microBadge } from '@/design-system/tokens/typography/presets';
import { dispatchUsavRefreshData, invalidateDashboardOrderQueries } from '@/lib/dashboard-query-invalidation';
import { useAuth } from '@/contexts/AuthContext';
import { OrderSyncDialog } from '@/components/sidebar/OrderSyncDialog';
import type {
  ExceptionsTabState,
  OrderExceptionResolutionDetail,
  SyncPhase,
  TransferOrderDetails,
  TransferTabState,
} from '@/lib/orders-sync/types';
import { streamNdjson } from '@/lib/orders-sync/client';

type PendingStockFilter = 'all' | 'pending' | 'stock';

const PENDING_STOCK_FILTER_ITEMS: HorizontalSliderItem[] = [
  { id: 'all',     label: 'All',       icon: Layout },
  { id: 'pending', label: 'Pick/Test', icon: Tool },
  { id: 'stock',   label: 'Stock',     icon: Box },
];

interface DashboardManagementPanelProps {
  showIntakeForm?: boolean;
  onCloseForm?: () => void;
  onFormSubmit?: (data: ShippedFormData) => void;
  filterControl?: ReactNode;
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

// Module-scope motion transitions / variants — defined here (not inside the
// component) so React doesn't re-allocate them on every render. These are
// intentionally local to this panel: they encode its specific kinetic rhythm
// and aren't shared across the design system.
const PANEL_ITEM_SPRING: Transition = { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 };
const PANEL_TASK_ROW_SPRING: Transition = { type: 'spring', damping: 20, stiffness: 300 };
const PANEL_ICON_POP_SPRING: Transition = { type: 'spring', damping: 12, stiffness: 300 };
const PANEL_STATUS_BANNER_SPRING: Transition = { type: 'spring', damping: 26, stiffness: 340, mass: 0.5 };
const PANEL_STATUS_ICON_SPRING: Transition = { type: 'spring', damping: 14, stiffness: 280, delay: 0.1 };

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
    transition: PANEL_ITEM_SPRING,
  },
};

function emptyTransferDetails(): TransferOrderDetails {
  return { inserted: [], updated: [], deleted: [], unknownTitle: [] };
}

function cloneDetails(d: TransferOrderDetails): TransferOrderDetails {
  return {
    inserted: [...d.inserted],
    updated: [...d.updated],
    deleted: [...d.deleted],
    unknownTitle: [...d.unknownTitle],
  };
}

function phaseSummary(phase: SyncPhase, count?: number): string {
  switch (phase) {
    case 'starting': return 'Starting…';
    case 'fetching_sheet': return 'Fetching sheet…';
    case 'fetching_ecwid': return 'Fetching Ecwid orders…';
    case 'resolving_tracking': return count ? `Resolving ${count} tracking number${count === 1 ? '' : 's'}…` : 'Resolving tracking…';
    case 'matching_orders': return 'Matching orders…';
    case 'inserting': return count ? `Inserting ${count} order${count === 1 ? '' : 's'}…` : 'Inserting…';
    case 'updating': return count ? `Updating ${count} order${count === 1 ? '' : 's'}…` : 'Updating…';
    case 'publishing': return 'Publishing changes…';
    case 'scanning_exceptions': return count ? `Scanning ${count} open exception${count === 1 ? '' : 's'}…` : 'Scanning exceptions…';
    case 'done': return 'Done';
    default: return 'Working…';
  }
}

export function DashboardManagementPanel({
  showIntakeForm = false,
  onCloseForm,
  onFormSubmit,
  filterControl,
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
  const { has } = useAuth();
  const canImportOrders = has('orders.import');
  type TaskStatus = 'idle' | 'running' | 'done' | 'error';
  type TaskState = { status: TaskStatus; summary?: string };
  const [sheetsTask, setSheetsTask] = useState<TransferTabState>({ status: 'idle' });
  const [ecwidTask, setEcwidTask] = useState<TransferTabState>({ status: 'idle' });
  const [exceptionsTask, setExceptionsTask] = useState<ExceptionsTabState>({ status: 'idle' });
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isTransferring =
    sheetsTask.status === 'running' ||
    ecwidTask.status === 'running' ||
    exceptionsTask.status === 'running';
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
      ecwidInserted?: number;
      durationMs?: number;
    };
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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
    setSheetsTask({ status: 'idle' });
    setEcwidTask({ status: 'idle' });
    setExceptionsTask({ status: 'idle' });
    setStatus({ type: 'error', message: 'Import cancelled' });
  };

  const handleTransfer = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setSheetsTask({ status: 'running', details: emptyTransferDetails() });
    setEcwidTask({ status: 'running', details: emptyTransferDetails() });
    // Exceptions sync runs AFTER sheets+ecwid finish so that rows just inserted
    // are visible to the matcher. Keep it idle/queued until then.
    setExceptionsTask({ status: 'idle', summary: 'Queued' });
    setStatus(null);
    setElapsedMs(0);
    setIsSyncDialogOpen(true);
    const t0 = Date.now();
    elapsedRef.current = setInterval(() => setElapsedMs(Date.now() - t0), 100);

    let sheetsResultPayload: Record<string, unknown> | null = null;
    let ecwidResultPayload: Record<string, unknown> | null = null;
    let exceptionsResultPayload: Record<string, unknown> | null = null;

    // Fires React Query invalidate + global refresh event so the dashboard
    // tables refetch *as soon as* a stream produces real changes. Without this
    // the dashboard only refreshed on `order.changed` from Ably — which
    // silently no-ops when the API key is missing — or at the very end of all
    // three streams.
    const refreshDashboard = async () => {
      await invalidateDashboardOrderQueries(queryClient);
      dispatchUsavRefreshData();
    };

    const consumeTransferStream = async (
      url: string,
      init: RequestInit,
      setter: typeof setSheetsTask,
    ): Promise<{ payload: Record<string, unknown> | null; error?: string }> => {
      // Local accumulator. We mutate this in-place and hand a fresh object to
      // the setter on each event so React renders the latest snapshot.
      const acc: TransferOrderDetails = emptyTransferDetails();
      let payload: Record<string, unknown> | null = null;
      let lastError: string | undefined;
      let hasWrites = false;

      try {
        await streamNdjson(url, init, (event) => {
          if (event.type === 'phase') {
            // The `publishing` phase fires right after the job's inserts/
            // updates land in the DB and before publish to Ably. Refresh the
            // dashboard tables immediately so users see new rows even if Ably
            // is misconfigured or the publish event is dropped in transit.
            if (event.phase === 'publishing' && hasWrites) void refreshDashboard();
            setter((prev) => ({
              ...prev,
              status: 'running',
              summary: phaseSummary(event.phase, event.count),
              phase: event.phase,
              details: cloneDetails(acc),
            } as TransferTabState));
          } else if (event.type === 'detail') {
            acc[event.kind].push(event.row);
            if (event.kind === 'inserted' || event.kind === 'updated' || event.kind === 'deleted') {
              hasWrites = true;
            }
            setter((prev) => ({
              ...prev,
              details: cloneDetails(acc),
              inserted: acc.inserted.length,
              updated: acc.updated.length,
              deleted: acc.deleted.length,
            } as TransferTabState));
          } else if (event.type === 'result') {
            payload = event.result;
            if (hasWrites) void refreshDashboard();
          } else if (event.type === 'error') {
            lastError = event.error;
          }
        });
      } catch (err: any) {
        lastError = err?.name === 'AbortError' ? 'Cancelled' : (err?.message || 'Network error');
      }

      const data = payload ?? {};
      const success = !lastError && (data as any).success !== false;
      const ins = Number((data as any).insertedOrders ?? acc.inserted.length);
      const upd = Number((data as any).updatedOrdersFields ?? acc.updated.length);
      const parts = [ins && `${ins} inserted`, upd && `${upd} updated`].filter(Boolean);
      setter({
        status: success ? 'done' : 'error',
        summary: success
          ? (parts.length > 0 ? (parts.join(', ') as string) : 'Up to date')
          : (lastError || (data as any).error || 'Failed'),
        error: success ? undefined : (lastError || (data as any).error || 'Failed'),
        details: cloneDetails(acc),
        inserted: ins,
        updated: upd,
        deleted: Number((data as any).deletedDuplicateOrders ?? acc.deleted.length),
        processedRows: Number((data as any).processedRows || 0),
        tabName: (data as any).tabName,
        phase: 'done',
      } as TransferTabState);
      return { payload: data, error: lastError };
    };

    const consumeExceptionsStream = async (
      url: string,
      init: RequestInit,
    ): Promise<{ payload: Record<string, unknown> | null; error?: string }> => {
      const resolved: OrderExceptionResolutionDetail[] = [];
      const stillOpen: OrderExceptionResolutionDetail[] = [];
      let payload: Record<string, unknown> | null = null;
      let lastError: string | undefined;

      try {
        await streamNdjson(url, init, (event) => {
          if (event.type === 'phase') {
            setExceptionsTask((prev) => ({
              ...prev,
              status: 'running',
              summary: phaseSummary(event.phase, event.count),
              phase: event.phase,
              resolved: [...resolved],
              stillOpen: [...stillOpen],
            }));
          } else if (event.type === 'exception') {
            if (event.kind === 'resolved') {
              resolved.push(event.row);
            } else {
              stillOpen.push(event.row);
            }
            setExceptionsTask((prev) => ({
              ...prev,
              resolved: [...resolved],
              stillOpen: [...stillOpen],
              matched: resolved.length,
              scanned: resolved.length + stillOpen.length,
            }));
          } else if (event.type === 'result') {
            payload = event.result;
            // Exception resolution can flip orders to 'shipped' — refresh the
            // dashboard so those status changes appear immediately.
            if (resolved.length > 0) void refreshDashboard();
          } else if (event.type === 'error') {
            lastError = event.error;
          }
        });
      } catch (err: any) {
        lastError = err?.name === 'AbortError' ? 'Cancelled' : (err?.message || 'Network error');
      }

      const data = payload ?? {};
      const success = !lastError && (data as any).success !== false;
      const matched = Number((data as any).matched ?? resolved.length);
      setExceptionsTask({
        status: success ? 'done' : 'error',
        summary: success
          ? (matched > 0 ? `${matched} resolved` : 'None pending')
          : (lastError || (data as any).error || 'Failed'),
        error: success ? undefined : (lastError || (data as any).error || 'Failed'),
        resolved: [...resolved],
        stillOpen: [...stillOpen],
        scanned: Number((data as any).scanned ?? (resolved.length + stillOpen.length)),
        matched,
        phase: 'done',
      });
      return { payload: data, error: lastError };
    };

    try {
      const [sheetsR, ecwidR] = await Promise.all([
        consumeTransferStream(
          '/api/google-sheets/transfer-orders',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manualSheetName: manualSheetName.trim() || undefined }),
            signal: controller.signal,
          },
          setSheetsTask,
        ),
        consumeTransferStream(
          '/api/ecwid/transfer-orders',
          { method: 'POST', signal: controller.signal },
          setEcwidTask,
        ),
      ]);
      sheetsResultPayload = sheetsR.payload;
      ecwidResultPayload = ecwidR.payload;

      setExceptionsTask({ status: 'running', phase: 'starting' });
      const exceptionsR = await consumeExceptionsStream('/api/orders-exceptions/sync', {
        method: 'POST',
        signal: controller.signal,
      });
      exceptionsResultPayload = exceptionsR.payload;

      const totalInserted = Number(sheetsResultPayload?.insertedOrders || 0)
        + Number(ecwidResultPayload?.insertedOrders || 0);
      const totalUpdated = Number(sheetsResultPayload?.updatedOrdersFields || 0)
        + Number(ecwidResultPayload?.updatedOrdersFields || 0);
      const exceptionsResolved = Number(exceptionsResultPayload?.matched || 0);

      await invalidateDashboardOrderQueries(queryClient);
      dispatchUsavRefreshData();

      const anyFailed = [sheetsR, ecwidR, exceptionsR].some(
        (r) => Boolean(r.error) || (r.payload && (r.payload as any).success === false),
      );
      const parts = [];
      if (totalInserted > 0) parts.push(`${totalInserted} inserted`);
      if (totalUpdated > 0) parts.push(`${totalUpdated} updated`);

      setStatus({
        type: anyFailed ? 'error' : 'success',
        message: parts.length > 0 ? `Orders synced: ${parts.join(', ')}` : 'Orders already up to date',
        details: {
          tabName: sheetsResultPayload?.tabName as string | undefined,
          inserted: totalInserted,
          updated: totalUpdated,
          processedRows: Number(sheetsResultPayload?.processedRows || 0)
            + Number(ecwidResultPayload?.processedRows || 0),
          exceptionsResolved,
          ecwidInserted: Number(ecwidResultPayload?.insertedOrders || 0),
          durationMs: Date.now() - t0,
        },
      });
    } catch (_error: any) {
      if (_error?.name === 'AbortError') return;
      setStatus({ type: 'error', message: 'Network error occurred' });
    } finally {
      abortRef.current = null;
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
  };


  // Reduced-motion-aware transitions for the two collapse-height regions.
  // Hooks must run unconditionally — keep these above any early returns.
  const expansionTransition = useMotionTransition(framerTransition.cardExpansion);
  const expansionDelayedTransition = useMotionTransition({ ...framerTransition.cardExpansion, delay: 0.15 });

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
        <div className={`${sidebarHeaderRowClass} shrink-0`}>
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
        </div>
        {showPendingFilterControl ? (
          <div className={sidebarHeaderPillRowClass}>
            <HorizontalButtonSlider
              items={PENDING_STOCK_FILTER_ITEMS}
              value={pendingFilterValue ?? 'all'}
              onChange={(tab) => onPendingFilterChange?.(tab === 'stock' ? 'stock' : tab === 'pending' ? 'pending' : 'all')}
              variant="nav"
              dense
              className="w-full"
              aria-label="Pending stock filter"
            />
          </div>
        ) : null}
        <div className={`h-full flex flex-col space-y-6 overflow-y-auto scrollbar-hide ${SIDEBAR_GUTTER} pb-6 pt-4`}>
          <div className="space-y-4">
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
                {canImportOrders ? (
                <>
                <div className="space-y-1.5">
                  <label className={`${microBadge} text-gray-500 px-1`}>Manual Sheet Name</label>
                  <input
                    type="text"
                    value={manualSheetName}
                    onChange={(e) => setManualSheetName(e.target.value)}
                    placeholder="e.g., Sheet_01_14_2026"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-caption font-mono text-gray-900 outline-none focus:border-blue-500 transition-all"
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

                {/* Compact status row — full details live in the centered OrderSyncDialog */}
                <AnimatePresence>
                  {isTransferring || sheetsTask.status !== 'idle' || ecwidTask.status !== 'idle' ? (
                    <motion.div
                      initial={framerPresence.collapseHeight.initial}
                      animate={framerPresence.collapseHeight.animate}
                      exit={framerPresence.collapseHeight.exit}
                      transition={expansionTransition}
                      className="overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => setIsSyncDialogOpen(true)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 text-left transition hover:bg-blue-100/60"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isTransferring ? (
                            <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5 text-blue-600" />
                          )}
                          <span className={`${sectionLabel} text-blue-700`}>
                            {isTransferring ? 'Importing orders…' : 'Import complete'}
                          </span>
                          <span className="text-eyebrow text-blue-400">View details</span>
                        </div>
                        <motion.span
                          key={Math.floor(elapsedMs / 1000)}
                          initial={{ opacity: 0.5, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-caption font-mono font-bold text-blue-500 tabular-nums"
                        >
                          {(elapsedMs / 1000).toFixed(1)}s
                        </motion.span>
                      </button>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                </>
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
                  transition={PANEL_STATUS_BANNER_SPRING}
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
                      transition={PANEL_STATUS_ICON_SPRING}
                    >
                      {status.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                    </motion.div>
                    <div className="min-w-0 flex-1">
                      <p className={sectionLabel}>{status.type === 'success' ? 'Sync Complete' : 'Sync Failed'}</p>
                      <p className="text-eyebrow font-medium leading-relaxed opacity-80">{status.message}</p>
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
                      initial={framerPresence.collapseHeight.initial}
                      animate={framerPresence.collapseHeight.animate}
                      transition={expansionDelayedTransition}
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
                              <p className="text-sm font-black text-emerald-700 tabular-nums">{stat.value}</p>
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

        </div>
      </motion.div>

      <OrderSyncDialog
        open={isSyncDialogOpen}
        onClose={() => setIsSyncDialogOpen(false)}
        isRunning={isTransferring}
        elapsedMs={elapsedMs}
        onCancel={handleCancelTransfer}
        sheets={sheetsTask}
        ecwid={ecwidTask}
        exceptions={exceptionsTask}
      />
    </>
  );
}
