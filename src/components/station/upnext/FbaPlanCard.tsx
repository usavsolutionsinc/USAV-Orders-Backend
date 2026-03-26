'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Loader2, Package } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import type { FbaPlanQueueItem } from './upnext-types';

/** Matches {@link FbaPlansUpNext} list easing; card root is a plain div so list wrapper owns `layout` + enter/exit. */
const CARD_EASE = [0.22, 1, 0.36, 1] as const;
/** Softer open/close — ease-out-heavy cubic for height + opacity. */
const PANEL_EASE = [0.25, 0.82, 0.2, 1] as const;

export interface FbaPlanCardProps {
  plan: FbaPlanQueueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** Highlights when this plan is loaded in the main /fba panel */
  isActive: boolean;
  /** Single-line plans: editable total qty */
  canEditQty?: boolean;
  qtyDraft?: string;
  onQtyChange?: (value: string) => void;
  onQtyBlur?: () => void;
  qtySaving?: boolean;
}

function getDaysLateNumber(dueDate: string | null | undefined) {
  const shipByKey = toPSTDateKey(dueDate);
  const todayKey = getCurrentPSTDateKey();
  if (!shipByKey || !todayKey) return 0;
  const [sy, sm, sd] = shipByKey.split('-').map(Number);
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const shipByIndex = Math.floor(Date.UTC(sy, sm - 1, sd) / 86400000);
  const todayIndex = Math.floor(Date.UTC(ty, tm - 1, td) / 86400000);
  return Math.max(0, todayIndex - shipByIndex);
}

function getDaysLateTone(daysLate: number) {
  if (daysLate > 1) return 'text-red-600';
  if (daysLate === 1) return 'text-yellow-600';
  return 'text-emerald-600';
}

/**
 * FBA **shipment plan** card — same chrome as {@link FbaItemCard}, for /fba workspace only.
 */
export function FbaPlanCard({
  plan,
  isExpanded,
  onToggleExpand,
  isActive,
  canEditQty = false,
  qtyDraft,
  onQtyChange,
  onQtyBlur,
  qtySaving = false,
}: FbaPlanCardProps) {
  const reduceMotion = useReducedMotion();
  const displayShipBy = plan.due_date || '';

  const chevronTransition = reduceMotion
    ? { duration: 0.01 }
    : ({ type: 'tween' as const, duration: 0.32, ease: PANEL_EASE });

  const panelTransition = reduceMotion
    ? { duration: 0.01 }
    : {
        height: { duration: 0.42, ease: PANEL_EASE },
        opacity: { duration: 0.34, ease: PANEL_EASE },
      };
  const daysLate = getDaysLateNumber(plan.due_date);
  const qtyBase =
    plan.total_expected_qty > 0 ? plan.total_expected_qty : Math.max(1, plan.total_items);
  const ref = String(plan.shipment_ref || '').trim();
  const fbaItemsLabel = `${plan.total_items} FBA item${plan.total_items !== 1 ? 's' : ''}`;
  const planTitle = ref || `Shipment row #${plan.id}`;
  const emitFocusPrintGroup = () => {
    window.dispatchEvent(
      new CustomEvent('fba-print-focus-plan', {
        detail: { shipmentId: plan.id, shipmentRef: ref || null },
      }),
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={`${planTitle}${isActive ? ', open in workspace' : ''}`}
      onClick={() => {
        emitFocusPrintGroup();
        onToggleExpand();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          emitFocusPrintGroup();
          onToggleExpand();
        }
      }}
      className={`border-b-2 px-0 py-3 transition-colors relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 ${
        isExpanded || isActive
          ? 'bg-white border-purple-500'
          : 'bg-white border-purple-300 hover:border-purple-500'
      }`}
    >
      <div className="flex items-center justify-between mb-4 px-3">
        <div className="flex items-center gap-2 min-w-0">
          {displayShipBy ? (
            <ShipByDate
              date={displayShipBy}
              showPrefix={false}
              showYear={false}
              icon={Package}
              iconClassName="w-4 h-4 text-purple-600"
              textClassName="text-[14px] font-black text-purple-700"
              className=""
            />
          ) : (
            <span className="text-[14px] font-black text-purple-700">No due date</span>
          )}
          <span className={`text-[14px] font-black shrink-0 ${getDaysLateTone(daysLate)}`}>{daysLate}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isActive ? (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-purple-800">
              Open
            </span>
          ) : null}
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={chevronTransition}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-pink-200 text-pink-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(236,72,153,0.16)]"
          >
            <ChevronDown className="w-4 h-4" />
          </motion.span>
        </div>
      </div>

      <div className="px-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-black text-gray-900">{fbaItemsLabel}</span>
          </div>
          <span
            className="max-w-[9.5rem] truncate text-[11px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300 shrink-0"
            title={ref || `Row ${plan.id}`}
          >
            {ref || `#${plan.id}`}
          </span>
        </div>
        <h4 className="text-base font-black text-gray-900 leading-tight truncate" title={planTitle}>
          {planTitle}
        </h4>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded ? (
          <motion.div
            key={`fba-plan-expanded-${plan.id}`}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={panelTransition}
            className="overflow-hidden"
          >
            <div className="mt-3 border-t border-purple-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="mb-1 text-gray-400">Plan ID</div>
                  <div className="text-[11px] font-mono text-gray-900 normal-case tracking-normal break-words">
                    {ref || '—'}
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="mb-1 text-gray-400">Shipment row ID</div>
                  <div className="text-[11px] tabular-nums text-gray-900 normal-case tracking-normal">
                    {plan.id}
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="mb-1 text-gray-400">Due</div>
                  <div className="text-[11px] text-gray-900 normal-case tracking-normal break-words">
                    {plan.due_date
                      ? new Date(plan.due_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Not set'}
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="mb-1 text-gray-400">FBA items</div>
                  <div className="text-[11px] tabular-nums tracking-normal text-gray-900 normal-case">
                    {plan.total_items}
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="mb-1 text-gray-400">Ready</div>
                  <div className="text-[11px] text-emerald-700 normal-case tracking-normal tabular-nums font-black">
                    {plan.ready_item_count}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">Qty</span>
                {canEditQty && onQtyChange ? (
                  <input
                    type="number"
                    min={0}
                    disabled={qtySaving}
                    value={qtyDraft ?? String(qtyBase)}
                    onChange={(e) => onQtyChange(e.target.value)}
                    onBlur={() => onQtyBlur?.()}
                    className="w-14 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-center text-[10px] font-black tabular-nums text-gray-900 outline-none focus:border-purple-400"
                  />
                ) : (
                  <span
                    className="text-[10px] font-black tabular-nums text-gray-700"
                    title={
                      plan.total_items !== 1 ? 'Open plan to edit multiple FBA items' : 'Progress locked qty'
                    }
                  >
                    {qtyBase}
                  </span>
                )}
                {qtySaving ? <Loader2 className="h-3 w-3 animate-spin text-gray-400" /> : null}
              </div>

              {plan.created_by_name ? (
                <p className="mt-2 text-[10px] font-bold text-gray-500 normal-case tracking-normal">
                  By {plan.created_by_name}
                </p>
              ) : null}

              {plan.total_items > 0 ? (
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.round((plan.ready_item_count / plan.total_items) * 100)}%`,
                    }}
                    transition={{
                      type: 'tween',
                      duration: reduceMotion ? 0.01 : 0.48,
                      ease: CARD_EASE,
                      delay: reduceMotion ? 0 : 0.07,
                    }}
                    className="h-full rounded-full bg-emerald-400"
                  />
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
