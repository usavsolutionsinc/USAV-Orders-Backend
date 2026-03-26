'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2, Search } from '@/components/Icons';
import { OverlaySearchBar } from '@/components/ui/OverlaySearchBar';
import { findStaffIdByNormalizedName, useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { FbaShippedHistory } from '@/components/fba/FbaShippedHistory';
import { FbaQuickAddFnskuModal } from '@/components/fba/FbaQuickAddFnskuModal';
import { FbaCreatePlanModal } from '@/components/fba/FbaCreatePlanModal';
import { FbaLoadingState, FbaErrorState } from '@/components/fba/FbaStateShells';
import { FbaBoardTable, type FbaBoardItem } from '@/components/fba/FbaBoardTable';
import WeekHeader from '@/components/ui/WeekHeader';
import StationFba from '@/components/station/StationFba';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';

type Tab = 'board' | 'paired' | 'shipped';

/** Compute Monday–Sunday YYYY-MM-DD range for the week containing today shifted by `weekOffset`. */
function getWeekRange(todayKey: string, weekOffset: number): { startStr: string; endStr: string } {
  const [y, m, d] = todayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + weekOffset * 7);
  const dow = date.getUTCDay(); // 0=Sun
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((dow + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return { startStr: fmt(monday), endStr: fmt(sunday) };
}

function isItemInWeek(item: FbaBoardItem, start: string, end: string): boolean {
  const key = item.due_date ? toPSTDateKey(item.due_date) : '';
  if (!key) return true; // items without a date always show
  return key >= start && key <= end;
}

function resolveActiveTab(rawTab: string | null): Tab {
  if (rawTab === 'paired') return 'paired';
  if (rawTab === 'shipped') return 'shipped';
  return 'board';
}

function buildFbaHref(params: URLSearchParams) {
  const query = params.toString();
  return query ? `/fba?${query}` : '/fba';
}

const TAB_LABELS: Record<Tab, string> = {
  board: 'Combine',
  paired: 'Review',
  shipped: 'Shipped',
};

interface BoardData {
  awaiting: FbaBoardItem[];
  packed: FbaBoardItem[];
  paired: FbaBoardItem[];
}

function FbaPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const refreshTrigger = Number(searchParams.get('r') || 0);
  const activeTab = resolveActiveTab(searchParams.get('tab'));

  const staffDirectory = useActiveStaffDirectory();
  const staffIdParam = String(searchParams.get('staffId') || '').trim();
  const staffIdFromUrl = /^\d+$/.test(staffIdParam) ? parseInt(staffIdParam, 10) : null;
  const lienStaffId = useMemo(
    () => findStaffIdByNormalizedName(staffDirectory, 'lien'),
    [staffDirectory],
  );
  const effectiveStaffIdForTheme = staffIdFromUrl ?? lienStaffId ?? 1;
  const selectedStaff = staffDirectory.find((member) => member.id === effectiveStaffIdForTheme);
  const staffRoleForTheme: 'technician' | 'packer' =
    selectedStaff?.role === 'packer' ? 'packer' : 'technician';
  const stationTheme = useMemo(
    () => getStaffThemeById(effectiveStaffIdForTheme, staffRoleForTheme),
    [effectiveStaffIdForTheme, staffRoleForTheme],
  );

  // ── Board data ────────────────────────────────────────────────────────
  const [board, setBoard] = useState<BoardData>({ awaiting: [], packed: [], paired: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBoard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/fba/board');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch board');
      setBoard({
        awaiting: data.awaiting ?? [],
        packed: data.packed ?? [],
        paired: data.paired ?? [],
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard, refreshTrigger]);

  useEffect(() => {
    const handler = () => fetchBoard();
    window.addEventListener('usav-refresh-data', handler);
    window.addEventListener('fba-print-shipped', handler);
    return () => {
      window.removeEventListener('usav-refresh-data', handler);
      window.removeEventListener('fba-print-shipped', handler);
    };
  }, [fetchBoard]);

  // ── Legacy URL redirects ──────────────────────────────────────────────
  useEffect(() => {
    const mode = String(searchParams.get('mode') || '').toUpperCase();
    const tab = searchParams.get('tab');
    const legacy =
      mode === 'PRINT_READY' || mode === 'READY_TO_GO' || mode === 'READY_TO_PRINT' ||
      tab === 'labels' || tab === 'summary' || tab === 'awaiting' || tab === 'packed';
    if (!legacy) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('mode');
    params.delete('print');
    params.delete('tab');
    router.replace(buildFbaHref(params));
  }, [searchParams, router]);

  // ── Paired selection → sidebar ─────────────────────────────────────────
  const handlePairedSelectionChange = useCallback((selected: FbaBoardItem[]) => {
    window.dispatchEvent(
      new CustomEvent('fba-paired-selection', { detail: selected }),
    );
  }, []);

  // ── Week pagination ──────────────────────────────────────────────────
  const todayKey = getCurrentPSTDateKey();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekRange = useMemo(() => getWeekRange(todayKey, weekOffset), [todayKey, weekOffset]);

  // ── Merged board: packed on top, then awaiting ─────────────────────────
  const boardItems = useMemo(
    () => [...board.packed, ...board.awaiting],
    [board.packed, board.awaiting],
  );

  const boardItemsForWeek = useMemo(
    () => boardItems.filter((i) => isItemInWeek(i, weekRange.startStr, weekRange.endStr)),
    [boardItems, weekRange],
  );
  const pairedItemsForWeek = useMemo(
    () => board.paired.filter((i) => isItemInWeek(i, weekRange.startStr, weekRange.endStr)),
    [board.paired, weekRange],
  );

  const activeItems = activeTab === 'board' ? boardItemsForWeek : activeTab === 'paired' ? pairedItemsForWeek : [];

  // ── FNSKU search ────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const searchVariant = useMemo((): 'blue' | 'orange' | 'emerald' | 'purple' | 'red' | 'gray' => {
    const m: Record<string, 'blue' | 'orange' | 'emerald' | 'purple' | 'red' | 'gray'> = {
      green: 'emerald', blue: 'blue', purple: 'purple',
      yellow: 'orange', black: 'gray', red: 'red', lightblue: 'blue', pink: 'red',
    };
    return m[stationTheme] ?? 'blue';
  }, [stationTheme]);

  // Clear search when tab changes
  useEffect(() => {
    setSearchQuery('');
    setSearchOpen(false);
  }, [activeTab]);

  // Auto-focus when search bar opens
  useEffect(() => {
    if (!searchOpen) return;
    const id = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(id);
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  const filteredBoardItems = useMemo(() => {
    if (!searchQuery.trim()) return boardItemsForWeek;
    const q = searchQuery.trim().toUpperCase();
    return boardItemsForWeek.filter(
      (item) =>
        item.fnsku.toUpperCase().includes(q) ||
        (item.display_title || '').toUpperCase().includes(q),
    );
  }, [boardItemsForWeek, searchQuery]);

  const filteredPairedItems = useMemo(() => {
    if (!searchQuery.trim()) return pairedItemsForWeek;
    const q = searchQuery.trim().toUpperCase();
    return pairedItemsForWeek.filter(
      (item) =>
        item.fnsku.toUpperCase().includes(q) ||
        (item.display_title || '').toUpperCase().includes(q),
    );
  }, [pairedItemsForWeek, searchQuery]);

  const showSearch = activeTab === 'board' || activeTab === 'paired';
  const visibleCount =
    activeTab === 'board' ? filteredBoardItems.length :
    activeTab === 'paired' ? filteredPairedItems.length :
    activeItems.length;

  const searchTransition = prefersReducedMotion
    ? { duration: 0.01 }
    : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };
  const themeColors = stationThemeColors[stationTheme];

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-stone-50">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-zinc-200/80 bg-white">
        <StationFba embedded>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <WeekHeader
              stickyDate={todayKey}
              fallbackDate="FBA Board"
              count={visibleCount}
              countClassName={stationThemeColors[stationTheme].text}
              formatDate={formatDateWithOrdinal}
              showWeekControls={activeTab !== 'shipped'}
              weekRange={weekRange}
              weekOffset={weekOffset}
              onPrevWeek={() => setWeekOffset((o) => o - 1)}
              onNextWeek={() => setWeekOffset((o) => Math.min(0, o + 1))}
              rightSlot={activeTab === 'shipped' ? (
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {TAB_LABELS[activeTab]}
                </span>
              ) : undefined}
            />

            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
              {loading && !boardItems.length && !board.paired.length ? (
                <FbaLoadingState theme={stationTheme} label="Loading board…" />
              ) : error ? (
                <FbaErrorState message={error} onRetry={fetchBoard} theme={stationTheme} />
              ) : activeTab === 'shipped' ? (
                <FbaShippedHistory refreshTrigger={refreshTrigger} stationTheme={stationTheme} />
              ) : activeTab === 'paired' ? (
                <FbaBoardTable
                  items={filteredPairedItems}
                  variant="paired"
                  stationTheme={stationTheme}
                  emptyMessage={searchQuery ? 'No items match this FNSKU' : 'No paired items with tracking'}
                  onSelectionChange={handlePairedSelectionChange}
                />
              ) : (
                <FbaBoardTable
                  items={filteredBoardItems}
                  variant="board"
                  stationTheme={stationTheme}
                  emptyMessage={searchQuery ? 'No items match this FNSKU' : 'No FBA items'}
                />
              )}

              {/* Floating FNSKU search — board + paired tabs only */}
              {showSearch ? (
                <>
                  <AnimatePresence initial={false} mode="wait">
                    {searchOpen ? (
                      <div key="fba-search-bar" className="absolute bottom-3 left-3 z-30 w-[320px]">
                        <OverlaySearchBar
                          value={searchQuery}
                          onChange={setSearchQuery}
                          onClear={() => setSearchQuery('')}
                          onClose={closeSearch}
                          inputRef={searchInputRef}
                          placeholder="Filter by FNSKU…"
                          variant={searchVariant}
                          className="w-full"
                        />
                      </div>
                    ) : null}
                  </AnimatePresence>

                  <AnimatePresence initial={false} mode="wait">
                    {!searchOpen ? (
                      <motion.button
                        key="fba-search-trigger"
                        type="button"
                        initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                        whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                        whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                        transition={searchTransition}
                        onClick={() => setSearchOpen(true)}
                        className={`absolute bottom-3 left-3 z-30 flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm will-change-transform transition ${themeColors.bg} ${themeColors.hover}`}
                        aria-label="Search by FNSKU"
                      >
                        <Search className="h-4 w-4" />
                      </motion.button>
                    ) : null}
                  </AnimatePresence>
                </>
              ) : null}
            </div>
          </div>
          <FbaQuickAddFnskuModal stationTheme={stationTheme} />
          <FbaCreatePlanModal stationTheme={stationTheme} />
        </StationFba>
      </div>
    </div>
  );
}

export default function FbaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-stone-100/80 px-6">
          <div className="rounded-2xl border border-zinc-200/80 bg-white px-6 py-5 text-center shadow-sm shadow-zinc-200/70">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-gray-400" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-700">
              Loading FBA workspace
            </p>
          </div>
        </div>
      }
    >
      <FbaPageContent />
    </Suspense>
  );
}
