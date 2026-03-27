'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Package } from '@/components/Icons';
import { PrintTableCheckbox } from '@/components/fba/table/Checkbox';
import { ShipByDate } from '@/components/ui/ShipByDate';
import type { StationTheme } from '@/utils/staff-colors';
import { getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { resolveFbaPlanQtyBase } from '@/lib/fba/qty';
import type { FbaPlanQueueItem } from './upnext-types';

/** Matches {@link FbaPlansUpNext} list easing; card root is a plain div so list wrapper owns `layout` + enter/exit. */
const CARD_EASE = [0.22, 1, 0.36, 1] as const;

export interface FbaPlanCardProps {
  plan: FbaPlanQueueItem;
  stationTheme: StationTheme;
  /** Highlights when this plan is loaded in the main /fba panel */
  isActive: boolean;
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

/** Fixed FBA plan card chrome — purple card, blue date/divider, purple icon. */
const FBA_PLAN_CHROME = {
  cardActive: 'bg-white border-purple-500',
  cardIdle: 'bg-white border-purple-300 hover:border-purple-500',
  cardFocusRing: 'focus-visible:ring-2 focus-visible:ring-purple-400/50',
  cardDateText: 'text-[14px] font-black text-blue-700',
  cardChevron:
    'inline-flex h-8 w-8 items-center justify-center rounded-full border border-purple-200 text-purple-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(147,51,234,0.16)]',
  cardExpandedDivider: 'border-t border-blue-200',
  cardQtyInput:
    'w-14 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-center text-[10px] font-black tabular-nums text-gray-900 outline-none focus:border-purple-400',
  cardProgress: 'h-full rounded-full bg-purple-400',
  iconClass: 'text-purple-600',
  dateIconClass: 'text-blue-600',
} as const;

/**
 * FBA **shipment plan** card — fixed purple/blue chrome, not station-themed.
 */
export function FbaPlanCard({
  plan,
  stationTheme,
  isActive,
}: FbaPlanCardProps) {
  const reduceMotion = useReducedMotion();
  const chrome = FBA_PLAN_CHROME;
  const [daySelected, setDaySelected] = useState(false);
  const displayShipBy = plan.due_date || '';

  const daysLate = getDaysLateNumber(plan.due_date);
  const qtyBase = resolveFbaPlanQtyBase(plan);
  const ref = String(plan.shipment_ref || '').trim();
  const fbaItemsLabel = `${plan.total_items} FBA item${plan.total_items !== 1 ? 's' : ''}`;
  const planTitle = ref || `Shipment row #${plan.id}`;
  const progressPct = qtyBase > 0 ? Math.min(100, Math.round((plan.ready_item_count / qtyBase) * 100)) : 0;
  const emitFocusPrintGroup = () => {
    window.dispatchEvent(
      new CustomEvent('fba-print-focus-plan', {
        detail: { shipmentId: plan.id, shipmentRef: ref || null },
      }),
    );
  };

  // Reset checked state when sidebar clears all selections
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === 'none') setDaySelected(false);
    };
    window.addEventListener('fba-board-toggle-all', handler);
    return () => window.removeEventListener('fba-board-toggle-all', handler);
  }, []);

  const selectBoardItemsByDay = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    if (!plan.due_date) return;
    const dayKey = String(plan.due_date).slice(0, 10);
    if (!dayKey) return;
    if (daySelected) {
      setDaySelected(false);
      window.dispatchEvent(new CustomEvent('fba-board-deselect-by-day', { detail: dayKey }));
    } else {
      setDaySelected(true);
      window.dispatchEvent(new CustomEvent('fba-board-select-by-day', { detail: dayKey }));
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${planTitle}${isActive ? ', loaded in workspace' : ''}`}
      onClick={() => emitFocusPrintGroup()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          emitFocusPrintGroup();
        }
      }}
      className={`border-b-2 px-0 py-3 transition-colors relative cursor-pointer outline-none ${chrome.cardFocusRing} ${
        isActive ? chrome.cardActive : chrome.cardIdle
      }`}
    >
      {/* Header: date + days late + active badge */}
      <div className="flex items-center gap-2 mb-2 px-3 min-w-0">
        {displayShipBy ? (
          <ShipByDate
            date={displayShipBy}
            showPrefix={false}
            showYear={false}
            icon={Package}
            iconClassName={`w-4 h-4 ${chrome.iconClass}`}
            textClassName={chrome.cardDateText}
            className=""
          />
        ) : (
          <span className={chrome.cardDateText}>No due date</span>
        )}
        <span className={`text-[14px] font-black shrink-0 ${getDaysLateTone(daysLate)}`}>{daysLate}</span>
      </div>

      {/* Title + ref */}
      <div className="px-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-black text-gray-900">{fbaItemsLabel}</span>
          <span
            className="max-w-[9.5rem] truncate text-[11px] font-mono font-black text-gray-900 px-1.5 py-0.5 rounded border border-gray-300 shrink-0"
            title={ref || `Row ${plan.id}`}
          >
            {ref || `#${plan.id}`}
          </span>
        </div>
        {plan.due_date ? (
          <div className="flex items-center gap-2">
            <PrintTableCheckbox
              checked={daySelected}
              onChange={() => selectBoardItemsByDay({ stopPropagation: () => {} })}
              stationTheme={stationTheme}
              label="Select all items for this day"
            />
            <button
              type="button"
              onClick={selectBoardItemsByDay}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectBoardItemsByDay(e);
                }
              }}
              className="text-[10px] font-black uppercase tracking-widest text-gray-600 hover:text-gray-900 focus-visible:outline-none"
            >
              Select All
            </button>
          </div>
        ) : null}
      </div>

      {/* Always-visible details — no expand/collapse */}
      <div className="mt-3 px-3 pt-3 border-t border-blue-200">
        <div className="grid grid-cols-3 gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
          <div className="rounded-xl bg-gray-50 px-2.5 py-2">
            <div className="mb-0.5 text-gray-400">Planned</div>
            <div className="text-[11px] tabular-nums text-gray-900 normal-case tracking-normal">
              {plan.total_items}
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 px-2.5 py-2">
            <div className="mb-0.5 text-gray-400">Qty</div>
            <div className="text-[11px] tabular-nums text-gray-900 normal-case tracking-normal">
              {qtyBase}
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 px-2.5 py-2">
            <div className="mb-0.5 text-gray-400">Ready</div>
            <div className="text-[11px] text-emerald-700 normal-case tracking-normal tabular-nums font-black">
              {plan.ready_item_count}
            </div>
          </div>
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
              animate={{ width: `${progressPct}%` }}
              transition={{
                type: 'tween',
                duration: reduceMotion ? 0.01 : 0.48,
                ease: CARD_EASE,
                delay: reduceMotion ? 0 : 0.07,
              }}
              className={chrome.cardProgress}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
