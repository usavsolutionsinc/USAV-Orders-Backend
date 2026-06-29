'use client';

import {
  getOrderIdLast4,
  getDaysLateTone,
  stripConditionPrefix,
} from '@/utils/upnext-helpers';
import { formatMonthDay } from '@/utils/date';
import type { RailRowVM } from '@/components/sidebar/rail-shell/RailRowBody';
import type { Order } from './upnext-types';

/**
 * Adapter: an Up-Next `Order` → the shared `RailRowVM` slot contract. This is
 * the seam that lets the tech Up-Next card render through the same row anatomy
 * primitive (`RailRowBody`) as the receiving/testing recent rail, while keeping
 * all order-specific vocabulary (urgency phrasing, condition/qty tones) in one
 * pure place. The view stays dumb; this file owns the order display rules.
 *
 * The `card` facts are the bits `useUpNextCard` derives (days-late, quantity,
 * ship-by date) — passed in rather than re-derived so the adapter stays pure.
 */
export interface OrderRailFacts {
  daysLate: number | null;
  quantity: number;
  displayShipByDate: string | null | undefined;
}

/**
 * Compact urgency phrase shown at the left of the meta row. Mirrors the
 * vocabulary used in `OrderPreviewPanel` so the same word appears in both.
 */
export function describeOrderUrgency(daysLate: number | null): string {
  return describeUrgency(daysLate);
}
function describeUrgency(daysLate: number | null): string {
  if (daysLate === null) return 'No date';
  if (daysLate > 1) return `${daysLate}d late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)}d ahead`;
}

/**
 * Condition pill tone (meta-trailing).
 * New → yellow (the marquee state, draws the eye)
 * Parts → brown/amber-900 (downgraded — "this needs disassembly")
 * Used / refurb / anything else → neutral slate so it doesn't compete.
 */
function getConditionBadgeClasses(condition: string | null | undefined): string | null {
  const c = (condition || '').toLowerCase().trim();
  if (!c) return null;
  if (c.includes('new')) return 'bg-yellow-100 text-yellow-800';
  if (c.includes('part')) return 'bg-amber-200 text-amber-900';
  return 'bg-slate-100 text-slate-700';
}

/**
 * Quantity-pill tone. ×1 reads as "nothing special" (gray); ×2+ grabs the eye
 * (amber) because multi-unit orders need extra care during picking.
 */
function getQtyBadgeClasses(quantity: number): string {
  if (quantity >= 2) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

/**
 * Leading status-dot tone for the recent-rail order row, by urgency. Mirrors
 * the colours of the Up-Next urgency summary bar (red late / amber due) so the
 * row dot and the section header agree.
 */
export function getOrderUrgencyDot(daysLate: number | null): string {
  if (daysLate === null) return 'bg-gray-300';
  if (daysLate > 1) return 'bg-red-500';
  if (daysLate >= 0) return 'bg-amber-400'; // due today / due tomorrow
  return 'bg-emerald-500'; // ahead of schedule
}

export function getOrderUrgencyDotLabel(daysLate: number | null): string {
  if (daysLate === null) return 'No ship-by date';
  if (daysLate > 1) return `${daysLate} days late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)} days ahead`;
}

export function orderToRailVM(order: Order, facts: OrderRailFacts): RailRowVM {
  const title = stripConditionPrefix(order.product_title, order.condition);
  const shortId = getOrderIdLast4(order.order_id);
  const channel = order.account_source || 'Order';
  // Strip the year — sidebar reads as "May 15", not "2026-05-15".
  const shipByMonthDay = formatMonthDay(facts.displayShipByDate) || '—';
  const urgencyText = describeUrgency(facts.daysLate);
  const daysLateTextTone = getDaysLateTone(facts.daysLate);
  const conditionBadgeClasses = getConditionBadgeClasses(order.condition);
  const qtyBadgeClasses = getQtyBadgeClasses(facts.quantity);
  // Don't include the tech's own name — the queue is already filtered to their
  // work. Surface other assignees only.
  const assigneeLabel =
    order.tester_name && String(order.tester_name).trim() ? order.tester_name : null;

  return {
    eyebrow: (
      <>
        <span className="font-mono font-bold text-gray-700">#{shortId}</span>
        <span className="text-gray-300">·</span>
        <span className="truncate">{channel}</span>
        {assigneeLabel ? (
          <>
            <span className="text-gray-300">·</span>
            <span className="truncate text-gray-700">{assigneeLabel}</span>
          </>
        ) : null}
      </>
    ),
    title,
    // No native `title=` tooltip — the rich hover popover is the preview.
    meta: (
      <span className="flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
          {shipByMonthDay}
        </span>
        <span className={`font-bold tracking-tight ${daysLateTextTone}`}>{urgencyText}</span>
      </span>
    ),
    metaTrailing: (
      <>
        {order.condition && conditionBadgeClasses ? (
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-micro font-black uppercase tracking-wide ${conditionBadgeClasses}`}
          >
            {order.condition}
          </span>
        ) : null}
        <span className={`rounded px-1.5 font-mono text-micro font-bold ${qtyBadgeClasses}`}>
          ×{facts.quantity}
        </span>
      </>
    ),
  };
}
