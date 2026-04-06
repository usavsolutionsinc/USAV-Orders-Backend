'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { MobileShell } from '@/design-system/components/mobile/MobileShell';
import { MobileStationPacking } from '../station/MobileStationPacking';
import { MobilePackerTable } from './MobilePackerTable';
import { normalizeTrackingKey } from '@/lib/tracking-format';
import { MobilePageHeader } from '@/components/mobile/shared/MobilePageHeader';
import { useActiveStaffDirectory } from '@/components/sidebar/hooks';
import { usePackerLogs } from '@/hooks/usePackerLogs';
import { getStaffGoalById } from '@/lib/staffGoalsCache';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { ChevronRight, Package } from '@/components/Icons';
import { PackerDetailsStack } from '@/components/shipped/stacks/PackerDetailsStack';
import {
  MobileBoxedNavChevron,
  dispatchOpenMobileAppDrawer,
} from '@/design-system/components/mobile';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function deduplicateByTracking(records: Array<{ shipping_tracking_number: string; tracking_type: string | null; order_id: string | null; account_source: string | null }>) {
  const seen = new Set<string>();
  return records.filter((r) => {
    const isFba =
      String(r.tracking_type || '').toUpperCase() === 'FNSKU' ||
      String(r.account_source || '').toLowerCase() === 'fba';
    if (isFba) return true;
    const key = normalizeTrackingKey(r.shipping_tracking_number);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface MobilePackerDashboardProps {
  packerId: string;
}

type MobilePackerPane = 'station' | 'history';

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * MobilePackerDashboard — mobile orchestrator for the packer station.
 *
 * Uses a stacked drill-down flow:
 *   station (packing wizard) → history (table) → details (slide-in)
 *
 * Header arrows navigate between panes.
 * No floating hamburger — the back arrow returns to the master nav.
 */
export function MobilePackerDashboard({ packerId }: MobilePackerDashboardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dailyGoal, setDailyGoal] = useState(50);
  const [activePane, setActivePane] = useState<MobilePackerPane>('station');
  const [selectedDetail, setSelectedDetail] = useState<ShippedOrder | null>(null);
  const [orderedDetails, setOrderedDetails] = useState<ShippedOrder[]>([]);
  const staffDirectory = useActiveStaffDirectory();

  const packerMember = staffDirectory.find((m) => String(m.id) === String(packerId));
  const packerName = packerMember?.name || 'Packer';

  useEffect(() => {
    getStaffGoalById(packerId).then(setDailyGoal).catch(() => {});
  }, [packerId]);

  const weekRange = useMemo(() => computeCurrentWeekRange(), []);
  const { data: records = [] } = usePackerLogs(parseInt(packerId, 10), { weekOffset: 0, weekRange });

  const todayCount = useMemo(() => {
    const todayDate = getCurrentPSTDateKey();
    const todayRecords = records.filter(
      (r) => toPSTDateKey(r.created_at || '') === todayDate,
    );
    return deduplicateByTracking(todayRecords).length;
  }, [records]);

  const refreshHistory = () => {
    queryClient.invalidateQueries({ queryKey: ['packer-logs'] });
  };

  const selectedDetailIndex = useMemo(
    () => (
      selectedDetail
        ? orderedDetails.findIndex((d) => Number(d.id) === Number(selectedDetail.id))
        : -1
    ),
    [orderedDetails, selectedDetail],
  );

  const canGoBack =
    selectedDetail !== null
    || activePane === 'history'
    || activePane === 'station';
  const canGoForward = selectedDetail !== null
    ? selectedDetailIndex >= 0 && selectedDetailIndex < orderedDetails.length - 1
    : activePane === 'station';

  useEffect(() => {
    if (!selectedDetail) return;
    const stillExists = orderedDetails.some((d) => Number(d.id) === Number(selectedDetail.id));
    if (!stillExists) setSelectedDetail(null);
  }, [orderedDetails, selectedDetail]);

  const navigateDetail = (step: -1 | 1) => {
    if (selectedDetailIndex < 0) return;
    const next = orderedDetails[selectedDetailIndex + step];
    if (!next) return;
    setSelectedDetail(next);
  };

  const handleBack = () => {
    if (selectedDetail) {
      if (selectedDetailIndex > 0) {
        navigateDetail(-1);
        return;
      }
      setSelectedDetail(null);
      return;
    }
    if (activePane === 'history') {
      setActivePane('station');
      return;
    }
    if (activePane === 'station') {
      dispatchOpenMobileAppDrawer();
    }
  };

  const handleForward = () => {
    if (selectedDetail) {
      navigateDetail(1);
      return;
    }
    if (activePane === 'station') {
      setActivePane('history');
    }
  };

  const onStaffSelect = useCallback(
    (staffId: number, _staffName: string) => {
      router.replace(`/packer?staffId=${encodeURIComponent(String(staffId))}`);
    },
    [router],
  );

  /** Same shell fill pattern as mobile tech (`MobileTechDashboard` `shellFill`). */
  const shellFill = 'min-h-0 w-full flex-1 h-full';

  const headerBackLabel =
    selectedDetail !== null
      ? 'Back'
      : activePane === 'station'
        ? 'Open app navigation'
        : 'Back to pack station';

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white">
        <MobilePageHeader
          onBack={handleBack}
          backAriaLabel={headerBackLabel}
          staffRole="packer"
          selectedStaffId={parseInt(packerId, 10)}
          onStaffSelect={onStaffSelect}
          trailing={
            activePane === 'station' && !selectedDetail ? (
              <button
                type="button"
                onClick={handleForward}
                disabled={!canGoForward}
                aria-label="Open pack history"
                className="flex h-full w-full items-center justify-center rounded-none bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 disabled:pointer-events-none disabled:opacity-35"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : undefined
          }
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activePane === 'station' ? (
            <MobileStationPacking
              userId={packerId}
              userName={packerName}
              staffId={packerId}
              todayCount={todayCount}
              goal={dailyGoal}
              onComplete={refreshHistory}
              suppressShellToolbar
              shellClassName={shellFill}
            />
          ) : (
            <MobileShell className={shellFill} toolbar={false}>
              <MobilePackerTable
                packerId={parseInt(packerId, 10)}
                selectedDetailId={selectedDetail ? Number(selectedDetail.id) : null}
                onOpenDetail={setSelectedDetail}
                onOrderedDetailsChange={setOrderedDetails}
              />
            </MobileShell>
          )}
        </div>
      </div>

      {/* Detail slide-in overlay */}
      <AnimatePresence>
        {selectedDetail ? (
          <motion.div
            key={`packer-detail-${selectedDetail.id}`}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320, mass: 0.65 }}
            className="fixed inset-0 z-[70] overflow-hidden bg-white"
          >
            <div className="h-full overflow-y-auto overscroll-contain pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="px-4 pb-3">
                <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-900 text-white">
                      <Package className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-black tracking-tight text-gray-900">
                        {selectedDetail.order_id || 'Packer Detail'}
                      </p>
                      <p className="truncate text-[9px] font-black uppercase tracking-[0.22em] text-gray-500">
                        {selectedDetail.product_title || 'Order details'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <MobileBoxedNavChevron
                      direction="left"
                      onClick={handleBack}
                      disabled={!canGoBack}
                    />
                    <MobileBoxedNavChevron
                      direction="right"
                      onClick={handleForward}
                      disabled={!canGoForward}
                    />
                  </div>
                </div>
              </div>

              <PackerDetailsStack
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
