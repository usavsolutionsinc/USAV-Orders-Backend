'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import {
  CardShell,
  SkeletonOrderCard,
} from '@/design-system';
import { AlertCircle } from '@/components/Icons';
import { dispatchUpNextPreview } from '@/utils/events';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import {
  getOrderIdLast4,
  getDaysLateTone,
  stripConditionPrefix,
} from '@/utils/upnext-helpers';
import { formatMonthDay } from '@/utils/date';
import { useUpNextCard } from '@/hooks/station/useUpNextCard';
import type { Order } from './upnext-types';

interface OrderCardProps {
  order: Order;
  effectiveTab: string;
  techId: string;
  /**
   * True when this card's order is the current right-pane preview/active
   * target. Drives the Linear-style selection accent (left bar + tint).
   */
  isSelected?: boolean;
}

/**
 * Compact urgency phrase shown at the right of the meta row. Mirrors the
 * vocabulary used in `OrderPreviewPanel` so the same word appears in both
 * surfaces.
 */
function describeUrgency(daysLate: number | null): string {
  if (daysLate === null) return 'No date';
  if (daysLate > 1) return `${daysLate}d late`;
  if (daysLate === 1) return 'Due today';
  if (daysLate === 0) return 'Due tomorrow';
  return `${Math.abs(daysLate)}d ahead`;
}

/**
 * Badge classes for the condition pill that lives in the bottom-right row.
 * New → yellow (the marquee state, draws the eye)
 * Parts → brown/amber-900 (downgraded — "this needs disassembly")
 * Used / refurb / anything else → neutral slate so it doesn't compete
 */
function getConditionBadgeClasses(condition: string | null | undefined): string | null {
  const c = (condition || '').toLowerCase().trim();
  if (!c) return null;
  if (c.includes('new')) return 'bg-yellow-100 text-yellow-800';
  if (c.includes('part')) return 'bg-amber-200 text-amber-900';
  return 'bg-slate-100 text-slate-700';
}

/**
 * Quantity-pill classes. ×1 reads as "nothing special" (gray); ×2+ grabs
 * the eye (amber) because multi-unit orders need extra care during picking.
 */
function getQtyBadgeClasses(quantity: number): string {
  if (quantity >= 2) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

/**
 * Sidebar Up Next card — Linear-style row.
 *
 * Actions (Start / Out of Stock) live in the right-pane `UpNextActionDock`
 * mounted by `ActiveOrderWorkspace` in `mode='preview'`. Clicking the card
 * toggles the workspace preview via `dispatchUpNextPreview`. Selection is
 * the left 3px accent bar — the row never leaves the stack.
 */
export function OrderCard({
  order,
  effectiveTab,
  techId,
  isSelected = false,
}: OrderCardProps) {
  const card = useUpNextCard({
    order,
    effectiveTab,
    showMissingPartsInput: null,
    onMissingPartsReasonChange: () => {},
  });
  const daysLateTextTone = getDaysLateTone(card.daysLate);
  const urgencyText = describeUrgency(card.daysLate);
  const title = stripConditionPrefix(order.product_title, order.condition);
  const shortId = getOrderIdLast4(order.order_id);
  const channel = order.account_source || 'Order';
  // Strip the year — sidebar reads as "May 15", not "2026-05-15".
  const shipByMonthDay = formatMonthDay(card.displayShipByDate) || '—';
  const conditionBadgeClasses = getConditionBadgeClasses(order.condition);
  const qtyBadgeClasses = getQtyBadgeClasses(card.quantity);
  // Don't include the tech's own name in the meta row — the queue is already
  // filtered to their work. Surface other assignees only.
  const assigneeLabel = order.tester_name && String(order.tester_name).trim()
    ? order.tester_name
    : null;

  return (
    <>
      <CardShell
        isSelected={isSelected}
        isStock={card.isStockTab}
        variant="linear"
        entrance="stagger"
        onClick={() => {
          dispatchUpNextPreview(isSelected ? null : { kind: 'order', order });
        }}
      >
        {/* ── Row 1 — id · channel · assignee. Plain text — the external
              listing link lives in the right-pane preview, not here. The
              trailing chevron slot has reserved width so opacity fade
              doesn't shift the row. ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-gray-500">
            <span className="font-mono font-bold text-gray-700">#{shortId}</span>
            <span className="text-gray-300">·</span>
            <span className="truncate">{channel}</span>
            {assigneeLabel ? (
              <>
                <span className="text-gray-300">·</span>
                <span className="truncate text-gray-700">{assigneeLabel}</span>
              </>
            ) : null}
          </div>
          <span
            aria-hidden
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm leading-none text-gray-400 transition-opacity ${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            ›
          </span>
        </div>

        {/* ── Row 2 — title alone, the visual anchor. Qty + condition have
              moved out to the bottom-right meta row so the title reads as a
              clean product name without prefix noise. ── */}
        <h4 className="mt-0.5 line-clamp-1 text-sm font-semibold leading-snug tracking-tight text-gray-900">
          {title}
        </h4>

        {/* ── Row 3 — ship-by pill (month+day, no year) + urgency phrase on
              the left; condition badge + qty pill anchored to the right.
              Condition tones: New = yellow, Parts = brown, else = neutral.
              Qty tones: ×1 = gray, ×2+ = amber. ── */}
        <div className="mt-1.5 flex items-center gap-1.5 text-caption">
          <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
            {shipByMonthDay}
          </span>
          <span className={`font-bold tracking-tight ${daysLateTextTone}`}>
            {urgencyText}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {order.condition && conditionBadgeClasses ? (
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-micro font-black uppercase tracking-wide ${conditionBadgeClasses}`}
              >
                {order.condition}
              </span>
            ) : null}
            <span
              className={`rounded px-1.5 font-mono text-micro font-bold ${qtyBadgeClasses}`}
            >
              ×{card.quantity}
            </span>
          </div>
        </div>

        {/* ── Out-of-stock strip — read-only banner; editing happens in the
              workspace dock. ── */}
        {card.hasOutOfStock && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-red-100 bg-red-50/60 px-2 py-1">
            <AlertCircle className="h-3 w-3 flex-shrink-0 text-red-500" />
            <span className="min-w-0 flex-1 truncate text-caption font-semibold text-red-700">
              {order.out_of_stock}
            </span>
          </div>
        )}
      </CardShell>

      {/* Assignment overlay — portal to escape framer-motion transform stacking context */}
      {card.mounted && createPortal(
        <AnimatePresence>
          {card.showAssignment && (
            <WorkOrderAssignmentCard
              rows={[card.workOrderRow]}
              startIndex={0}
              technicianOptions={card.technicianOptions}
              packerOptions={card.packerOptions}
              onConfirm={card.handleAssignConfirm}
              onClose={() => card.setShowAssignment(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

OrderCard.Skeleton = SkeletonOrderCard;
