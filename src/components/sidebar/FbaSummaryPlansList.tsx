'use client';

import type { Dispatch, SetStateAction } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Trash2, X, Copy } from '@/components/Icons';

export interface FbaSidebarPendingPlan {
  id: number;
  shipment_ref: string;
  due_date: string | null;
  total_items: number;
  total_expected_qty: number;
  ready_item_count: number;
  shipped_item_count: number;
  created_by_name: string | null;
  created_at: string;
}

type FbaTab = 'summary' | 'shipped';

function dueDateLabel(due: string | null): { text: string; cls: string } {
  if (!due) return { text: 'No date', cls: 'text-zinc-400' };
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, cls: 'text-red-600 font-black' };
  if (days === 0) return { text: 'Due today', cls: 'text-amber-600 font-black' };
  if (days === 1) return { text: 'Due tomorrow', cls: 'text-amber-500 font-bold' };
  return { text: `${days} days`, cls: 'text-zinc-500' };
}

function formatPlanDayHeader(dayKey: string): string {
  if (dayKey === '__nodate__') return 'No due date';
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type UpdateFbaParams = (patch: {
  plan?: number | null;
  tab?: FbaTab;
  mode?: 'PLAN' | 'PRINT_READY' | null;
}) => void;

interface FbaSummaryPlansListProps {
  plansLoading: boolean;
  pendingPlans: FbaSidebarPendingPlan[];
  plansByDay: { dayKey: string; plans: FbaSidebarPendingPlan[] }[];
  dupToast: string | null;
  duplicating: boolean;
  onDuplicateYesterday: () => void;
  activePlanId: number | null;
  deletingPlanId: number | null;
  deleteLoading: boolean;
  onDeletePlan: (planId: number) => void;
  onClearDeleteIntent: () => void;
  onBeginDeletePlan: (planId: number) => void;
  updateFbaParams: UpdateFbaParams;
  planQtyDraft: Record<number, string>;
  setPlanQtyDraft: Dispatch<SetStateAction<Record<number, string>>>;
  qtySavingPlanId: number | null;
  onCommitPlanQty: (plan: FbaSidebarPendingPlan) => void;
}

export function FbaSummaryPlansList({
  plansLoading,
  pendingPlans,
  plansByDay,
  dupToast,
  duplicating,
  onDuplicateYesterday,
  activePlanId,
  deletingPlanId,
  deleteLoading,
  onDeletePlan,
  onClearDeleteIntent,
  onBeginDeletePlan,
  updateFbaParams,
  planQtyDraft,
  setPlanQtyDraft,
  qtySavingPlanId,
  onCommitPlanQty,
}: FbaSummaryPlansListProps) {
  return (
    <div className="flex flex-col">
      {plansLoading && pendingPlans.length === 0 ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : !plansLoading && pendingPlans.length === 0 ? (
        <p className="py-10 text-center text-[9px] font-semibold italic text-zinc-500">No open plans</p>
      ) : (
        plansByDay.map(({ dayKey, plans }, gi) => (
          <div key={dayKey}>
            <div className="flex h-11 w-full shrink-0 items-center justify-between border-b border-zinc-200 bg-zinc-100/90 px-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-800">
                {formatPlanDayHeader(dayKey)}
              </span>
              {gi === 0 ? (
                <div className="flex items-center gap-2">
                  <AnimatePresence>
                    {dupToast && (
                      <motion.span
                        key="dup-toast"
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-[8px] font-semibold italic text-emerald-600"
                      >
                        {dupToast}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.88 }}
                    disabled={duplicating}
                    onClick={onDuplicateYesterday}
                    title="Copy yesterday's plan to today"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800 disabled:opacity-40"
                  >
                    {duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                  </motion.button>
                </div>
              ) : null}
            </div>
            <AnimatePresence initial={false}>
              {plans.map((plan, i) => {
                const due = dueDateLabel(plan.due_date);
                const isActive = activePlanId === plan.id;
                const isConfirmDelete = deletingPlanId === plan.id;
                const qtyBase =
                  plan.total_expected_qty > 0 ? plan.total_expected_qty : Math.max(1, plan.total_items);
                const canEditQty = plan.total_items === 1 && plan.ready_item_count === 0;
                return (
                  <motion.div
                    key={plan.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16, scale: 0.96 }}
                    transition={{ duration: 0.18, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                    className={`flex items-stretch border-b border-white/15 ${isActive ? 'bg-violet-200/35' : 'bg-white/45'}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onClearDeleteIntent();
                        updateFbaParams({
                          plan: isActive ? null : plan.id,
                          tab: 'summary',
                          mode: isActive ? undefined : 'PLAN',
                        });
                      }}
                      className={`min-w-0 flex-1 px-3 py-2 text-left transition-colors ${isActive ? '' : 'hover:bg-zinc-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-black text-zinc-900">
                            {plan.shipment_ref}
                          </span>
                          {plan.due_date && new Date(plan.due_date) < new Date(Date.now() - 2 * 86400000) && (
                            <span
                              className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-700"
                              title="Plan is overdue"
                            >
                              ⚠
                            </span>
                          )}
                        </div>
                        {isActive && (
                          <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-violet-700">
                            Open
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span className={`text-[9px] ${due.cls}`}>{due.text}</span>
                        <span className="text-[9px] text-zinc-400">·</span>
                        <span className="text-[9px] tabular-nums text-zinc-400">
                          {plan.total_items} line{plan.total_items !== 1 ? 's' : ''}
                        </span>
                        {plan.ready_item_count > 0 && (
                          <>
                            <span className="text-[9px] text-zinc-400">·</span>
                            <span className="text-[9px] tabular-nums text-emerald-600">
                              {plan.ready_item_count} ready
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">Qty</span>
                        {canEditQty ? (
                          <input
                            type="number"
                            min={0}
                            disabled={qtySavingPlanId === plan.id}
                            value={planQtyDraft[plan.id] ?? String(qtyBase)}
                            onChange={(e) => setPlanQtyDraft((d) => ({ ...d, [plan.id]: e.target.value }))}
                            onBlur={() => void onCommitPlanQty(plan)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-14 rounded-md border border-zinc-200 bg-white px-1.5 py-1 text-center text-[10px] font-black tabular-nums text-zinc-900 outline-none focus:border-violet-400"
                          />
                        ) : (
                          <span
                            className="text-[10px] font-black tabular-nums text-zinc-700"
                            title={
                              plan.total_items !== 1 ? 'Open plan to edit multiple lines' : 'Progress locked qty'
                            }
                          >
                            {qtyBase}
                          </span>
                        )}
                        {qtySavingPlanId === plan.id ? (
                          <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                        ) : null}
                      </div>
                      {plan.total_items > 0 && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{
                              width: `${Math.round((plan.ready_item_count / plan.total_items) * 100)}%`,
                            }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className="h-full rounded-full bg-emerald-400"
                          />
                        </div>
                      )}
                    </button>
                    <AnimatePresence mode="wait" initial={false}>
                      {isConfirmDelete ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, width: 0 }}
                          animate={{ opacity: 1, width: 'auto' }}
                          exit={{ opacity: 0, width: 0 }}
                          className="flex items-center gap-0.5 overflow-hidden border-l border-zinc-100 px-1.5"
                        >
                          <button
                            type="button"
                            disabled={deleteLoading}
                            onClick={() => onDeletePlan(plan.id)}
                            className="flex h-6 items-center gap-1 rounded bg-red-500 px-2 text-[9px] font-black uppercase tracking-wide text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                          >
                            {deleteLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Del'}
                          </button>
                          <button
                            type="button"
                            onClick={onClearDeleteIntent}
                            className="flex h-6 w-6 items-center justify-center rounded text-zinc-300 hover:text-zinc-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </motion.div>
                      ) : (
                        <motion.button
                          key="trash"
                          type="button"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onBeginDeletePlan(plan.id);
                          }}
                          className="border-l border-zinc-100 px-3 text-zinc-400 transition-colors hover:text-red-500"
                          aria-label="Delete plan"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ))
      )}
    </div>
  );
}
