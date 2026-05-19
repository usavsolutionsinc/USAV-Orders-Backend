'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import {
  cardTitle,
  CardShell,
  SkeletonOrderCard,
} from '@/design-system';
import { AlertCircle } from '@/components/Icons';
import { dispatchUpNextPreview } from '@/utils/events';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import {
  getOrderIdLast4,
  getDaysLateTone,
  getConditionColor,
  stripConditionPrefix,
} from '@/utils/upnext-helpers';
import { useUpNextCard } from '@/hooks/station/useUpNextCard';
import type { Order } from './upnext-types';
import { UpNextHeaderExternalLinkChip } from './UpNextHeaderExternalLinkChip';

interface OrderCardProps {
  order: Order;
  effectiveTab: string;
  techId: string;
  /**
   * True when this card's order is the current right-pane preview/active
   * target. Drives the framed selected look (ring + tint + lift) so the
   * card reads as "the one being inspected" from any side of the row,
   * not just the left edge.
   */
  isSelected?: boolean;
}

/**
 * Sidebar Up Next card — display only.
 *
 * Actions (Start / Out of Stock) live in the right-pane `UpNextActionDock`
 * mounted by `ActiveOrderWorkspace` in `mode='preview'`. Clicking the card
 * toggles the workspace preview via `dispatchUpNextPreview`; the framed
 * selected state matches the workspace tint for cross-pane continuity.
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
    // Card no longer hosts the OOS editor — pass inert defaults to the hook.
    showMissingPartsInput: null,
    onMissingPartsReasonChange: () => {},
  });
  const externalItemUrl = card.getExternalUrlByItemNumber(card.itemNumberValue);
  const daysLateTextTone = getDaysLateTone(card.daysLate);

  return (
    <>
      <CardShell
        isSelected={isSelected}
        isStock={card.isStockTab}
        variant="framed"
        onClick={() => {
          dispatchUpNextPreview(isSelected ? null : { kind: 'order', order });
        }}
      >
        {/* ── Header — ship-by + days-late chip on the left, order-id chip
              on the right. The framed ring is the only selection accent. ── */}
        <div className="flex items-center justify-between mb-3 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShipByDate
              date={card.displayShipByDate || ''}
              showPrefix={false}
              showYear={false}
              className="[&>span]:text-[13px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
            />
            <span className={`text-[12px] font-black tracking-tight ${daysLateTextTone}`}>
              {card.daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <UpNextHeaderExternalLinkChip
              label={`#${getOrderIdLast4(order.order_id)}`}
              canOpen={!!externalItemUrl}
              onOpen={() => card.openExternalByItemNumber(card.itemNumberValue)}
              ariaLabel="Open order in external page"
            />
          </div>
        </div>

        {/* ── Body — title is the visual anchor. Qty prefix + condition
              chip read inline so the row scans as one phrase. ── */}
        <div className="px-3">
          <h4 className={`${cardTitle} text-[15px] font-semibold tracking-tight leading-snug`}>
            <InlineQtyPrefix quantity={card.quantity} />
            {order.condition && (
              <>
                <span className={getConditionColor(order.condition)}>{order.condition}</span>{' '}
              </>
            )}
            {stripConditionPrefix(order.product_title, order.condition)}
          </h4>
        </div>

        {/* ── Out-of-stock strip — read-only. Editing happens in the
              workspace dock; this is just a heads-up at the bottom of
              the card so the tech sees it in the list at a glance. ── */}
        {card.hasOutOfStock && (
          <div className="mt-2.5 mx-3 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50/60 px-2.5 py-1.5">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-red-700">
              {order.out_of_stock}
            </span>
            <span className="hidden flex-shrink-0 text-[9px] font-black uppercase tracking-widest text-red-400 sm:inline">
              Edit in workspace
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
