'use client';

/**
 * Open FBA plans list for the /fba workspace only (sidebar).
 * Embeds the same LayoutGroup + motion stack pattern as {@link StationTesting} → Up Next.
 * Do not mount on station/testing routes.
 */

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Loader2, Package } from '@/components/Icons';
import type { FbaPlanQueueItem } from './upnext-types';
import { FbaPlanCard } from './FbaPlanCard';

const STATION_EASE_HEIGHT = [0.25, 0.1, 0.25, 1] as const;
const stationLayoutTween = { layout: { duration: 0.32, ease: STATION_EASE_HEIGHT } };

type FbaTab = 'summary' | 'shipped';

function formatPlanDayHeader(dayKey: string): string {
  if (dayKey === '__nodate__') return 'No due date';
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type UpdateFbaParams = (patch: { plan?: number | null; tab?: FbaTab }) => void;

export interface FbaPlansUpNextProps {
  plansLoading: boolean;
  pendingPlans: FbaPlanQueueItem[];
  plansByDay: { dayKey: string; plans: FbaPlanQueueItem[] }[];
  activePlanId: number | null;
  updateFbaParams: UpdateFbaParams;
  planQtyDraft: Record<number, string>;
  setPlanQtyDraft: Dispatch<SetStateAction<Record<number, string>>>;
  qtySavingPlanId: number | null;
  onCommitPlanQty: (plan: FbaPlanQueueItem) => void;
}

function PlansSectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
      <div className="h-px flex-1 bg-purple-200" />
      <span className="text-[9px] font-black uppercase tracking-widest text-purple-600">{label}</span>
      <div className="h-px flex-1 bg-purple-200" />
    </div>
  );
}

function EmptyPlansSlate({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl px-4 py-3 border bg-purple-50 border-purple-100"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-purple-400">{label}</p>
        <Package className="w-5 h-5 flex-shrink-0 text-purple-200" />
      </div>
    </motion.div>
  );
}

export function FbaPlansUpNext({
  plansLoading,
  pendingPlans,
  plansByDay,
  activePlanId,
  updateFbaParams,
  planQtyDraft,
  setPlanQtyDraft,
  qtySavingPlanId,
  onCommitPlanQty,
}: FbaPlansUpNextProps) {
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);

  const togglePlanCard = useCallback(
    (plan: FbaPlanQueueItem, key: string) => {
      setExpandedItemKey((cur) => {
        if (cur === key) {
          if (activePlanId === plan.id) {
            updateFbaParams({ plan: null, tab: 'summary' });
          }
          return null;
        }
        updateFbaParams({ plan: plan.id, tab: 'summary' });
        return key;
      });
    },
    [activePlanId, updateFbaParams],
  );

  return (
    <div className="space-y-3 px-1 pb-2">
      {plansLoading && pendingPlans.length === 0 ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-purple-300" />
        </div>
      ) : !plansLoading && pendingPlans.length === 0 ? (
        <EmptyPlansSlate label="No open plans" />
      ) : (
        <LayoutGroup id="fba-open-plans-upnext">
          <motion.div layout transition={stationLayoutTween} className="space-y-2">
            {plansByDay.map(({ dayKey, plans }, gi) => (
              <div key={dayKey}>
                {gi > 0 ? <div className="pt-1" /> : null}
                <PlansSectionHeader label={formatPlanDayHeader(dayKey)} />
                <div className="flex flex-col">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {plans.map((plan) => {
                      const key = `plan-${plan.id}`;
                      const isExpanded = expandedItemKey === key;
                      const isActive = activePlanId === plan.id;
                      const canEditQty = plan.total_items === 1 && plan.ready_item_count === 0;

                      return (
                        <motion.div
                          key={plan.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="min-w-0"
                        >
                          <FbaPlanCard
                            plan={plan}
                            isExpanded={isExpanded}
                            onToggleExpand={() => togglePlanCard(plan, key)}
                            isActive={isActive}
                            canEditQty={canEditQty}
                            qtyDraft={planQtyDraft[plan.id]}
                            onQtyChange={(v) => setPlanQtyDraft((d) => ({ ...d, [plan.id]: v }))}
                            onQtyBlur={() => void onCommitPlanQty(plan)}
                            qtySaving={qtySavingPlanId === plan.id}
                          />
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </motion.div>
        </LayoutGroup>
      )}
    </div>
  );
}
