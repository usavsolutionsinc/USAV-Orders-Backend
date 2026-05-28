'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { FbaQuickAddFnskuModal } from '@/components/fba/FbaQuickAddFnskuModal';
import { FbaCreatePlanModal } from '@/components/fba/FbaCreatePlanModal';
import { FbaErrorState } from '@/components/fba/FbaStateShells';
import { FbaBoardTable, type FbaBoardItem } from '@/components/fba/FbaBoardTable';
import { FbaBoardDetailPanel } from '@/components/fba/FbaBoardDetailPanel';
import StationFba from '@/components/station/StationFba';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useAuth } from '@/contexts/AuthContext';
import { useFbaRealtimeInvalidation } from '@/hooks/useFbaRealtimeInvalidation';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { USAV_REFRESH_DATA, FBA_PRINT_SHIPPED, FBA_BOARD_INJECT_ITEM, FBA_BOARD_REMOVE_ITEMS } from '@/lib/fba/events';
import { FbaSidebarPanel } from '@/components/fba/sidebar';
import { FbaPairedReviewPanel } from '@/components/fba/sidebar/FbaPairedReviewPanel';
import { FbaActiveShipments } from '@/components/fba/sidebar/FbaActiveShipments';
import { useFbaBoardSelection } from '@/components/fba/hooks/useFbaBoardSelection';
import { RouteShell } from '@/design-system/components/RouteShell';
import { resolveFbaMode } from '@/lib/fba/fba-modes';

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

interface CombineData {
  pending: FbaBoardItem[];
}

function FbaPageContent() {
  const searchParams = useSearchParams();
  useFbaRealtimeInvalidation();

  const refreshTrigger = Number(searchParams.get('r') || 0);
  const activeMode = resolveFbaMode(searchParams.get('mode'));

  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const { theme: stationTheme } = useStationTheme({ staffId });

  // ── Combine data ─────────────────────────────────────────────────────
  const [board, setBoard] = useState<CombineData>({ pending: [] });
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
        pending: data.pending ?? [...(data.packed ?? []), ...(data.awaiting ?? [])],
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
    window.addEventListener(USAV_REFRESH_DATA, handler);
    window.addEventListener(FBA_PRINT_SHIPPED, handler);

    // Select-mode auto-add: inject a single item without a full board refresh.
    const injectHandler = (e: Event) => {
      const item = (e as CustomEvent<FbaBoardItem>).detail;
      if (!item?.item_id) return;
      setBoard((prev) => {
        if (prev.pending.some((i) => i.item_id === item.item_id)) return prev;
        return { pending: [...prev.pending, item] };
      });
    };
    window.addEventListener(FBA_BOARD_INJECT_ITEM, injectHandler);

    // After combine/ship: remove items from board immediately.
    const removeHandler = (e: Event) => {
      const ids = (e as CustomEvent<number[]>).detail;
      if (!Array.isArray(ids) || ids.length === 0) return;
      const removeSet = new Set(ids);
      setBoard((prev) => ({
        pending: prev.pending.filter((i) => !removeSet.has(i.item_id)),
      }));
    };
    window.addEventListener(FBA_BOARD_REMOVE_ITEMS, removeHandler);

    return () => {
      window.removeEventListener(USAV_REFRESH_DATA, handler);
      window.removeEventListener(FBA_PRINT_SHIPPED, handler);
      window.removeEventListener(FBA_BOARD_INJECT_ITEM, injectHandler);
      window.removeEventListener(FBA_BOARD_REMOVE_ITEMS, removeHandler);
    };
  }, [fetchBoard]);

  // ── Week pagination ──────────────────────────────────────────────────
  const todayKey = getCurrentPSTDateKey();
  const [weekOffset, setWeekOffset] = useState(0);
  const weekRange = useMemo(() => getWeekRange(todayKey, weekOffset), [todayKey, weekOffset]);

  const combineItemsForWeek = useMemo(
    () => board.pending.filter((i) => isItemInWeek(i, weekRange.startStr, weekRange.endStr)),
    [board.pending, weekRange],
  );

  // Each mode scopes the board to its worklist:
  //   plan    → PLANNED  (still being planned)
  //   combine → PACKED   (packed and ready to combine under one FBA shipment ID)
  const filteredPendingItems = useMemo(() => {
    if (activeMode === 'plan') return combineItemsForWeek.filter((i) => i.item_status === 'PLANNED');
    if (activeMode === 'combine') return combineItemsForWeek.filter((i) => i.item_status === 'PACKED');
    return combineItemsForWeek;
  }, [combineItemsForWeek, activeMode]);

  const boardEmptyMessage =
    activeMode === 'plan' ? 'No items in planning' : 'No packed items to combine';

  // ── Combine workspace (center-right): board selection drives the combine
  //    review form; active shipments edit inline beneath it. ──────────────
  const boardSelection = useFbaBoardSelection({ includePairedSelection: true });
  const [pairedExpanded, setPairedExpanded] = useState(true);

  // ── Detail panel ────────────────────────────────────────────────────────
  const [detailItem, setDetailItem] = useState<FbaBoardItem | null>(null);

  const handleDetailNavigate = useCallback(
    (direction: 'up' | 'down') => {
      if (!detailItem) return;
      const list = filteredPendingItems;
      const idx = list.findIndex((i) => i.fnsku === detailItem.fnsku);
      const next = direction === 'up' ? idx - 1 : idx + 1;
      if (next >= 0 && next < list.length) setDetailItem(list[next]);
    },
    [detailItem, filteredPendingItems],
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-stone-50">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-zinc-200/80 bg-white">
        <StationFba embedded>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
              {error ? (
                <FbaErrorState message={error} onRetry={fetchBoard} theme={stationTheme} />
              ) : activeMode === 'shipped' ? (
                <div className="flex h-full flex-1 items-center justify-center px-5 text-center">
                  <p className="max-w-sm text-caption font-black uppercase tracking-widest text-gray-400">
                    Shipped mode is managed from the sidebar table.
                  </p>
                </div>
              ) : (
                <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  {/* Center: the board (PLANNED in plan mode, PACKED queue in combine) */}
                  <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                    <FbaBoardTable
                      items={filteredPendingItems}
                      loading={loading && !board.pending.length}
                      stationTheme={stationTheme}
                      emptyMessage={boardEmptyMessage}
                      onDetailOpen={setDetailItem}
                      weekRange={weekRange}
                      weekOffset={weekOffset}
                      onPrevWeek={() => setWeekOffset((o) => o - 1)}
                      onNextWeek={() => setWeekOffset((o) => Math.min(0, o + 1))}
                    />
                  </div>

                  {/* Right fill-out (combine only): combine-review form + active
                      shipment editing — the receiving-style center+right pattern. */}
                  {activeMode === 'combine' && (
                    <aside className="hidden w-[384px] shrink-0 flex-col overflow-y-auto border-l border-zinc-200/80 bg-white scrollbar-hide lg:flex">
                      <FbaPairedReviewPanel
                        selectedItems={boardSelection}
                        stationTheme={stationTheme}
                        expanded={pairedExpanded}
                        onToggleExpanded={() => setPairedExpanded((v) => !v)}
                      />
                      <FbaActiveShipments stationTheme={stationTheme} />
                    </aside>
                  )}
                </div>
              )}
            </div>
          </div>
          <FbaQuickAddFnskuModal stationTheme={stationTheme} />
          <FbaCreatePlanModal stationTheme={stationTheme} />

          {/* FNSKU detail panel */}
          <AnimatePresence>
            {detailItem && (
              <FbaBoardDetailPanel
                key="fba-detail-panel"
                item={detailItem}
                onClose={() => setDetailItem(null)}
                onNavigate={handleDetailNavigate}
                onSaved={fetchBoard}
                disableMoveUp={filteredPendingItems.findIndex((i) => i.fnsku === detailItem.fnsku) <= 0}
                disableMoveDown={
                  filteredPendingItems.findIndex((i) => i.fnsku === detailItem.fnsku) >=
                  filteredPendingItems.length - 1
                }
              />
            )}
          </AnimatePresence>
        </StationFba>
      </div>
    </div>
  );
}

export default function FbaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full flex-col bg-stone-50">
          <div className="h-10 bg-white border-b border-gray-100 flex items-center px-4">
            <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-200/80 bg-white px-6 py-8 text-center shadow-sm shadow-zinc-200/70">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-zinc-400" />
              <p className="mt-4 text-caption font-black uppercase tracking-[0.2em] text-zinc-500">
                Initializing Workspace
              </p>
            </div>
          </div>
        </div>
      }
    >
      <RouteShell actions={<FbaSidebarPanel />} history={<FbaPageContent />} />
    </Suspense>
  );
}
