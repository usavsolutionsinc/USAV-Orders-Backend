'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { ResolvedProductManual } from '@/hooks/useStationTestingController';
import { MobileShell } from '@/design-system/components/mobile/MobileShell';
import { MobileStationTesting } from '../station/MobileStationTesting';
import { MobileTechTable } from './MobileTechTable';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { useTechLogs, type TechRecord } from '@/hooks/useTechLogs';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { ChevronLeft, ChevronRight, Wrench } from '@/components/Icons';
import { TechDetailsStack } from '@/components/shipped/stacks/TechDetailsStack';
import { OrderIdChip } from '@/components/ui/CopyChip';
import {
  MobileTechTopBanner,
  type MobileTechViewMode,
  type MobileTechWorkspaceMode,
} from './MobileTechTopBanner';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import { DashboardShippedTable } from '@/components/shipped';
import UpdateManualsView from '@/components/UpdateManualsView';
import ProductManualViewer from '@/components/station/ProductManualViewer';

// ─── Helpers (same as TechSidebarPanel) ─────────────────────────────────────

function computeCurrentWeekRange() {
  const todayPst = getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return {
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}

function isFbaTechRecord(record: TechRecord): boolean {
  return (
    record.source_kind === 'fba_scan' ||
    record.account_source === 'fba' ||
    Boolean(String(record.fnsku || '').trim()) ||
    String(record.order_id || '').toUpperCase() === 'FBA'
  );
}

function deduplicateByTracking(records: TechRecord[]): TechRecord[] {
  const sorted = [...records].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  );
  const trackingIndex = new Map<string, number>();
  const unique: TechRecord[] = [];
  for (const record of sorted) {
    if (isFbaTechRecord(record)) { unique.push(record); continue; }
    const key = String(record.shipping_tracking_number || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!key) { unique.push(record); continue; }
    if (!trackingIndex.has(key)) {
      trackingIndex.set(key, unique.length);
      unique.push(record);
    }
  }
  return unique;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface MobileTechDashboardProps {
  techId: string;
}

function HeaderArrowButton({
  direction,
  onClick,
  disabled = false,
}: {
  direction: 'left' | 'right';
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Go back' : 'Go forward'}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors active:scale-95 disabled:opacity-35 disabled:active:scale-100"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function parseViewMode(rawView: string | null): MobileTechViewMode {
  const v = rawView?.trim() ?? '';
  if (v === 'hub') return 'hub';
  if (v === 'station') return 'station';
  if (v === 'pending') return 'pending';
  if (v === 'shipped') return 'shipped';
  if (v === 'manual') return 'manual';
  if (v === 'update-manuals') return 'update-manuals';
  if (v === 'history') return 'history';
  // No `view` or desktop-style URL (sidebar deletes `view` for Tech History) — match TechDashboard default.
  if (!v) return 'history';
  return 'history';
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileTechDashboard — mobile orchestrator for the tech station.
 *
 * Hub (`view=hub` only): StaffSelector + forward arrow only.
 * Otherwise same as desktop /tech: no `view` → Tech History; `view=station` → Testing Station (Up Next), etc.
 */
export function MobileTechDashboard({ techId }: MobileTechDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [dailyGoal, setDailyGoal] = useState(50);
  const [selectedDetail, setSelectedDetail] = useState<ShippedOrder | null>(null);
  const [orderedDetails, setOrderedDetails] = useState<ShippedOrder[]>([]);
  const [lastManuals, setLastManuals] = useState<ResolvedProductManual[]>([]);
  const staffDirectory = useActiveStaffDirectory();

  const rawView = searchParams.get('view');
  const viewMode = parseViewMode(rawView);

  const techMember = staffDirectory.find((m) => String(m.id) === String(techId));
  const techName = techMember?.name || 'Technician';

  useEffect(() => {
    getStaffGoalById(techId).then(setDailyGoal).catch(() => {});
  }, [techId]);

  useEffect(() => {
    const storageKey = `usav:last-manual:tech:${techId}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) { setLastManuals([]); return; }
      const parsed = JSON.parse(raw);
      setLastManuals(Array.isArray(parsed) ? parsed : [parsed]);
    } catch {
      setLastManuals([]);
    }

    const handleManualUpdate = (event: Event) => {
      const custom = event as CustomEvent<{ techId?: string; manuals?: ResolvedProductManual[] }>;
      if (String(custom?.detail?.techId || '') !== String(techId)) return;
      setLastManuals(Array.isArray(custom?.detail?.manuals) ? custom.detail.manuals : []);
    };

    window.addEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
    return () => window.removeEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
  }, [techId]);

  const weekRange = useMemo(() => computeCurrentWeekRange(), []);
  const { data: records = [] } = useTechLogs(parseInt(techId, 10), { weekOffset: 0, weekRange });

  const todayCount = useMemo(() => {
    const todayDate = getCurrentPSTDateKey();
    const todayRecords = records.filter(
      (r) => toPSTDateKey(r.created_at || '') === todayDate,
    );
    return deduplicateByTracking(todayRecords).length;
  }, [records]);

  const refreshHistory = () => {
    queryClient.invalidateQueries({ queryKey: ['tech-logs'] });
  };

  const updateViewMode = useCallback(
    (nextView: MobileTechViewMode) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('staffId', techId);
      if (nextView === 'hub') {
        nextParams.set('view', 'hub');
      } else if (nextView === 'history') {
        nextParams.set('view', 'history');
      } else if (nextView === 'station') {
        nextParams.set('view', 'station');
      } else {
        nextParams.set('view', nextView);
      }
      if (nextView !== 'pending' && nextView !== 'shipped') {
        nextParams.delete('search');
        nextParams.delete('searchOpen');
      }
      const nextSearch = nextParams.toString();
      router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
    },
    [router, searchParams, techId],
  );

  const selectedDetailIndex = useMemo(
    () => (
      selectedDetail
        ? orderedDetails.findIndex((detail) => Number(detail.id) === Number(selectedDetail.id))
        : -1
    ),
    [orderedDetails, selectedDetail],
  );

  const canGoForwardDetail = selectedDetailIndex >= 0 && selectedDetailIndex < orderedDetails.length - 1;

  useEffect(() => {
    if (viewMode !== 'history') {
      setSelectedDetail(null);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!selectedDetail) return;
    const stillExists = orderedDetails.some((detail) => Number(detail.id) === Number(selectedDetail.id));
    if (!stillExists) {
      setSelectedDetail(null);
    }
  }, [orderedDetails, selectedDetail]);

  const navigateDetail = (step: -1 | 1) => {
    if (selectedDetailIndex < 0) return;
    const nextDetail = orderedDetails[selectedDetailIndex + step];
    if (!nextDetail) return;
    setSelectedDetail(nextDetail);
  };

  /** History → Testing Station; other modes → app drawer. Detail overlay closes first. */
  const handleBack = useCallback(() => {
    if (selectedDetail) {
      setSelectedDetail(null);
      return;
    }
    if (viewMode === 'history') {
      updateViewMode('station');
      return;
    }
    window.dispatchEvent(new CustomEvent('open-mobile-drawer'));
  }, [selectedDetail, viewMode, updateViewMode]);

  /** Fills tech `main` flex region; `h-full` overrides MobileShell default `h-[100dvh]` via twMerge. */
  const shellFill = 'min-h-0 w-full flex-1 h-full';

  const onStaffSelect = useCallback(
    (id: number) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('staffId', String(id));
      if (viewMode === 'hub') {
        nextParams.set('view', 'hub');
      }
      router.push(`/tech?${nextParams.toString()}`);
    },
    [router, searchParams, viewMode],
  );

  return (
    <>
      {/* `flex-1 min-h-0` fills ResponsiveLayout main so inner `flex-1` (table/station) gets height; `h-[100dvh]` alone does not participate in parent flex and collapses the body. */}
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white">
        {viewMode === 'hub' ? (
          <MobileTechTopBanner
            variant="hub"
            selectedStaffId={parseInt(techId, 10)}
            onStaffSelect={onStaffSelect}
            onOpenAppNav={handleBack}
            onOpenWorkspaceFromHub={() => updateViewMode('history')}
          />
        ) : (
          <MobileTechTopBanner
            variant="workspace"
            selectedStaffId={parseInt(techId, 10)}
            onStaffSelect={onStaffSelect}
            onOpenAppNav={handleBack}
            workspaceViewMode={viewMode as MobileTechWorkspaceMode}
            onWorkspaceViewChange={updateViewMode}
            onStationOpenTechHistory={() => updateViewMode('history')}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {viewMode === 'hub' ? (
            <div className="min-h-0 flex-1 bg-white" aria-hidden />
          ) : viewMode === 'station' ? (
            <MobileStationTesting
              userId={techId}
              userName={techName}
              staffId={techId}
              todayCount={todayCount}
              goal={dailyGoal}
              onComplete={refreshHistory}
              onTrackingScan={() => updateViewMode('history')}
              onViewManual={() => updateViewMode('manual')}
              showQueueSearchOverlay={false}
              shellClassName={shellFill}
              suppressShellToolbar
            />
          ) : viewMode === 'history' ? (
            <MobileShell className={shellFill} toolbar={false}>
              <MobileTechTable
                techId={parseInt(techId, 10)}
                selectedDetailId={selectedDetail ? Number(selectedDetail.id) : null}
                onOpenDetail={setSelectedDetail}
                onOrderedDetailsChange={setOrderedDetails}
              />
            </MobileShell>
          ) : viewMode === 'pending' ? (
            <MobileShell className={shellFill} toolbar={false}>
              <div className="h-full min-h-0 overflow-auto px-2 py-1.5">
                <PendingOrdersTable />
              </div>
            </MobileShell>
          ) : viewMode === 'shipped' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DashboardShippedTable testedBy={parseInt(techId, 10)} embedded />
            </div>
          ) : viewMode === 'manual' ? (
            <MobileShell className={shellFill} toolbar={false}>
              <div className="h-full min-h-0 overflow-auto px-2 py-2">
                <ProductManualViewer manuals={lastManuals} className="min-h-[50vh]" />
              </div>
            </MobileShell>
          ) : (
            <MobileShell className={shellFill} toolbar={false}>
              <div className="h-full min-h-0 overflow-auto">
                <UpdateManualsView techId={techId} days={30} />
              </div>
            </MobileShell>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedDetail ? (
          <motion.div
            key={`tech-detail-${selectedDetail.id}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320, mass: 0.65 }}
            className="fixed inset-0 z-[70] overflow-hidden bg-white"
          >
            <div className="h-full overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="px-3 pb-2">
                <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-2.5 py-1.5 shadow-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white">
                      <Wrench className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      {selectedDetail.order_id ? (
                        <OrderIdChip
                          value={String(selectedDetail.order_id)}
                          display={String(selectedDetail.order_id)}
                        />
                      ) : (
                        <p className="break-words text-[13px] font-black tracking-tight text-gray-900">
                          Tech Detail
                        </p>
                      )}
                      <p className="mt-0.5 break-words text-[9px] font-black uppercase tracking-[0.22em] text-gray-500">
                        {selectedDetail.product_title || 'Order details'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <HeaderArrowButton
                      direction="left"
                      onClick={handleBack}
                      disabled={false}
                    />
                    <HeaderArrowButton
                      direction="right"
                      onClick={() => navigateDetail(1)}
                      disabled={!canGoForwardDetail}
                    />
                  </div>
                </div>
              </div>

              <TechDetailsStack
                shipped={selectedDetail}
                durationData={{}}
                copiedAll={false}
                onCopyAll={() => {}}
                onUpdate={refreshHistory}
                actionBar={{
                  onClose: () => setSelectedDetail(null),
                  onMoveUp: () => navigateDetail(-1),
                  onMoveDown: () => navigateDetail(1),
                  disableMoveUp: selectedDetailIndex <= 0,
                  disableMoveDown: selectedDetailIndex < 0 || selectedDetailIndex >= orderedDetails.length - 1,
                }}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
