'use client';

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import {
  CardShell,
  SkeletonOrderCard,
} from '@/design-system';
import { AlertCircle } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { dispatchUpNextPreview } from '@/utils/events';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { RailRowBody } from '@/components/sidebar/rail-shell/RailRowBody';
import { RailPopover } from '@/components/sidebar/rail-shell/RailPopover';
import { useRailHoverPreview } from '@/components/sidebar/rail-shell/useRailHoverPreview';
import { OrderRailPopover } from './OrderRailPopover';
import {
  orderToRailVM,
  getOrderUrgencyDot,
  getOrderUrgencyDotLabel,
} from './order-row-vm';
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
  isSelected = false,
}: OrderCardProps) {
  const card = useUpNextCard({
    order,
    effectiveTab,
    showMissingPartsInput: null,
    onMissingPartsReasonChange: () => {},
  });
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Shared hover-preview primitive — the same engine the receiving/testing rail
  // uses. Replaces the old plain `title=` tooltip with the rich `OrderRailPopover`.
  const preview = useRailHoverPreview();
  const urgencyLabel = getOrderUrgencyDotLabel(card.daysLate);

  return (
    <>
      {/* Recent-rail row treatment (`variant="rail"`): leading urgency dot +
          shared `RailRowBody` anatomy + house `bg-blue-50` ring selection. The
          old Up-Next "card" look is retired so the shipping queue reads as the
          same primitive as the receiving/testing recent rail. */}
      <CardShell
        ref={cardRef}
        isSelected={isSelected}
        isStock={card.isStockTab}
        variant="rail"
        entrance="stagger"
        onClick={() => {
          dispatchUpNextPreview(isSelected ? null : { kind: 'order', order });
        }}
        onMouseEnter={preview.scheduleOpen}
        onMouseLeave={preview.scheduleClose}
      >
        <div className="flex items-center gap-2.5">
          {/* Leading status dot — urgency tone (red late / amber due / emerald ahead). */}
          <HoverTooltip label={urgencyLabel} focusable={false} className="shrink-0">
            <span
              className={`block h-2 w-2 rounded-full ${getOrderUrgencyDot(card.daysLate)}`}
              aria-label={urgencyLabel}
            />
          </HoverTooltip>

          {/* Slots: eyebrow = id · channel · assignee (+ hover chevron); title =
              clean product name; meta = ship-by + urgency; meta-trailing =
              condition + qty. The rich preview is the hover popover below. */}
          <RailRowBody
            className="flex-1"
            vm={{
              ...orderToRailVM(order, {
                daysLate: card.daysLate,
                quantity: card.quantity,
                displayShipByDate: card.displayShipByDate,
              }),
              // Chevron depends on per-card selection/hover, so it's supplied
              // here rather than baked into the pure adapter.
              eyebrowTrailing: (
                <span
                  aria-hidden
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm leading-none text-text-faint transition-opacity ${
                    isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  ›
                </span>
              ),
            }}
          />
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

        {/* Hover preview — positioned by `RailPopover`, driven by the shared
            `useRailHoverPreview` engine; hovering the popover keeps it open. */}
        <AnimatePresence>
          {preview.isOpen ? (
            <RailPopover
              anchorEl={cardRef.current}
              onMouseEnter={preview.scheduleOpen}
              onMouseLeave={preview.scheduleClose}
              onDismiss={preview.dismiss}
            >
              <OrderRailPopover
                order={order}
                daysLate={card.daysLate}
                quantity={card.quantity}
                displayShipByDate={card.displayShipByDate}
                onOpen={() => {
                  dispatchUpNextPreview({ kind: 'order', order });
                  preview.dismiss();
                }}
              />
            </RailPopover>
          ) : null}
        </AnimatePresence>
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
