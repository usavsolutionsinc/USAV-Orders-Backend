'use client';

/**
 * Open FBA plans list for the /fba workspace only (sidebar).
 * Embeds the same LayoutGroup + motion stack pattern as {@link StationTesting} → Up Next.
 *
 * NOTE: This component is currently unused — the combine flow uses
 * FbaActiveShipments (DnD-enabled) in the sidebar instead.
 * Kept for potential future re-use.
 */

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Loader2, Package } from '@/components/Icons';
import type { StationTheme } from '@/utils/staff-colors';
import { fbaSidebarThemeChrome } from '@/utils/staff-colors';
import { FbaShipmentCard, type ActiveShipment } from './FbaShipmentCard';

const STATION_EASE_HEIGHT = [0.25, 0.1, 0.25, 1] as const;
const stationLayoutTween = { layout: { duration: 0.32, ease: STATION_EASE_HEIGHT } };

export interface FbaPlansUpNextProps {
  plansLoading: boolean;
  pendingPlans: ActiveShipment[];
  activePlanId: number | null;
  stationTheme: StationTheme;
  onCreatePlan?: () => void;
  onRefresh?: () => void;
}

function EmptyPlansSlate({
  label,
  stationTheme,
  onCreatePlan,
}: {
  label: string;
  stationTheme: StationTheme;
  onCreatePlan?: () => void;
}) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={chrome.emptyShell}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-bold uppercase tracking-widest ${chrome.emptyLabel}`}>{label}</p>
        <Package className={`w-5 h-5 flex-shrink-0 ${chrome.emptyIcon}`} />
      </div>
      {onCreatePlan ? (
        <button
          type="button"
          onClick={onCreatePlan}
          className="mt-2 text-[10px] font-black uppercase tracking-[0.14em] text-purple-700 underline"
        >
          + Create new plan
        </button>
      ) : null}
    </motion.div>
  );
}

export function FbaPlansUpNext({
  plansLoading,
  pendingPlans,
  activePlanId,
  stationTheme,
  onCreatePlan,
  onRefresh,
}: FbaPlansUpNextProps) {
  const chrome = fbaSidebarThemeChrome[stationTheme];
  const noop = () => {};

  return (
    <div className="space-y-3 px-1 pb-2">
      {plansLoading && pendingPlans.length === 0 ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className={`h-5 w-5 animate-spin ${chrome.loading}`} />
        </div>
      ) : !plansLoading && pendingPlans.length === 0 ? (
        <EmptyPlansSlate label="No open plans" stationTheme={stationTheme} onCreatePlan={onCreatePlan} />
      ) : (
        <LayoutGroup id="fba-open-plans-upnext">
          <motion.div layout transition={stationLayoutTween} className="space-y-2">
            <AnimatePresence mode="popLayout" initial={false}>
              {pendingPlans.map((plan) => (
                <motion.div
                  key={plan.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="min-w-0"
                >
                  <FbaShipmentCard
                    shipment={plan}
                    onRefresh={onRefresh || noop}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      )}
    </div>
  );
}
