'use client';

/**
 * `/fba` — thin composition layer. Logic lives in focused hooks:
 *   - useFbaBoard ......... board fetch + FBA event-bus inject/remove/refresh
 *   - useFbaWeekFilter .... week pagination + per-mode (PLANNED/PACKED) scoping
 *   - useFbaCombine ....... board selection + combine-workspace open state
 *   - useFbaDetailPanel ... FNSKU detail panel selection + nav
 *
 * Render is composition: the StationFba shell wraps <FbaBoardRegion> (board +
 * combine bar + workspace), the quick-add / create-plan modals, and the detail
 * panel.
 */

import { Suspense, useEffect, useRef } from 'react';
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { FbaQuickAddFnskuModal } from '@/components/fba/FbaQuickAddFnskuModal';
import { FbaCreatePlanModal } from '@/components/fba/FbaCreatePlanModal';
import { FbaBoardDetailPanel } from '@/components/fba/FbaBoardDetailPanel';
import { FbaBoardRegion } from '@/components/fba/FbaBoardRegion';
import StationFba from '@/components/station/StationFba';
import { useStationTheme } from '@/hooks/useStationTheme';
import { useAuth } from '@/contexts/AuthContext';
import { useFbaRealtimeInvalidation } from '@/hooks/useFbaRealtimeInvalidation';
import { FbaSidebarPanel } from '@/components/fba/sidebar';
import { RouteShell } from '@/design-system/components/RouteShell';
import { resolveFbaMode } from '@/lib/fba/fba-modes';
import { useSearchParams } from 'next/navigation';
import { useFbaBoard } from './useFbaBoard';
import { useFbaWeekFilter } from './useFbaWeekFilter';
import { useFbaCombine } from './useFbaCombine';
import { useFbaDetailPanel } from './useFbaDetailPanel';

function FbaPageContent() {
  const searchParams = useSearchParams();
  useFbaRealtimeInvalidation();

  const activeMode = resolveFbaMode(searchParams.get('mode'));
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;
  const { theme: stationTheme } = useStationTheme({ staffId });
  const prefersReducedMotion = useReducedMotion();

  const { board, loading, error, fetchBoard } = useFbaBoard();
  const weekFilter = useFbaWeekFilter(board.pending, activeMode);
  const combine = useFbaCombine(activeMode);
  const { detailItem, setDetailItem, handleDetailNavigate } = useFbaDetailPanel(
    weekFilter.filteredPendingItems,
  );

  const detailIdx = detailItem
    ? weekFilter.filteredPendingItems.findIndex((i) => i.fnsku === detailItem.fnsku)
    : -1;

  // Deep-link: cmd+k emits /fba?openShipmentId=<fba_shipments.id>. Open that
  // shipment's detail panel once the board has loaded. Only board (non-shipped)
  // shipments are openable — anything else no-ops (the board excludes SHIPPED).
  const openedShipmentRef = useRef<string | null>(null);
  useEffect(() => {
    const target = searchParams.get('openShipmentId');
    if (!target || !/^\d+$/.test(target)) return;
    if (openedShipmentRef.current === target) return;
    const shipmentId = Number(target);
    const match = board.pending.find((it) => it.shipment_id === shipmentId);
    if (match) {
      openedShipmentRef.current = target;
      setDetailItem(match);
    }
  }, [searchParams, board.pending, setDetailItem]);

  return (
    <div className="flex h-full w-full min-w-0 flex-1 flex-col bg-surface-canvas">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border-soft/80 bg-surface-card">
        <StationFba embedded>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-card">
              <FbaBoardRegion
                error={error}
                onRetry={fetchBoard}
                activeMode={activeMode}
                stationTheme={stationTheme}
                prefersReducedMotion={prefersReducedMotion}
                loading={loading}
                hasBoardItems={board.pending.length > 0}
                weekFilter={weekFilter}
                combine={combine}
                onDetailOpen={setDetailItem}
              />
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
                disableMoveUp={detailIdx <= 0}
                disableMoveDown={detailIdx >= weekFilter.filteredPendingItems.length - 1}
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
        <div className="flex h-full w-full flex-col bg-surface-canvas">
          <div className="h-10 bg-surface-card border-b border-border-hairline flex items-center px-4">
            <div className="h-4 w-32 bg-surface-sunken rounded animate-pulse" />
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-sm rounded-2xl border border-border-soft/80 bg-surface-card px-6 py-8 text-center shadow-sm shadow-zinc-200/70">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-text-faint" />
              <p className="mt-4 text-caption font-black uppercase tracking-[0.2em] text-text-soft">
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
