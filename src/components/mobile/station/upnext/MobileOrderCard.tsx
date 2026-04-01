'use client';

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  framerPresence,
  framerTransition,
  CardShell,
  ChevronToggle,
  DetailGrid,
  DetailCell,
  CopyIconButton,
  ExternalLinkButton,
} from '@/design-system';
import { Play, Settings } from '@/components/Icons';
import { ShipByDate } from '@/components/ui/ShipByDate';
import { PlatformExternalChip } from '@/components/ui/PlatformExternalChip';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { OutOfStockField } from '@/components/ui/OutOfStockField';
import { InlineQtyPrefix } from '@/components/ui/QtyBadge';
import { WorkOrderAssignmentCard } from '@/components/work-orders/WorkOrderAssignmentCard';
import { missingItemNumberLabel } from '@/utils/empty-display-value';
import {
  getOrderIdLast4,
  getLast4,
  getTrackingLast4,
  getDaysLateTone,
  getConditionColor,
} from '@/utils/upnext-helpers';
import { useUpNextCard } from '@/hooks/station/useUpNextCard';
import type { Order } from '@/components/station/upnext/upnext-types';
import { UpNextActionButton } from '@/components/station/upnext/UpNextActionButton';

interface MobileOrderCardProps {
  order: Order;
  effectiveTab: string;
  techId: string;
  showMissingPartsInput: number | null;
  missingPartsReason: string;
  onStart: (order: Order) => void;
  onMissingPartsToggle: (orderId: number) => void;
  onMissingPartsReasonChange: (reason: string) => void;
  onMissingPartsSubmit: (orderId: number) => void;
  onMissingPartsCancel: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function MobileOrderCard({
  order,
  effectiveTab,
  techId,
  showMissingPartsInput,
  missingPartsReason,
  onStart,
  onMissingPartsToggle,
  onMissingPartsReasonChange,
  onMissingPartsSubmit,
  onMissingPartsCancel,
  isExpanded,
  onToggleExpand,
}: MobileOrderCardProps) {
  const card = useUpNextCard({
    order,
    effectiveTab,
    showMissingPartsInput,
    onMissingPartsReasonChange,
  });

  return (
    <>
      <CardShell
        isExpanded={isExpanded}
        isStock={card.isStockTab}
        onClick={onToggleExpand}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4 px-3">
          <div className="flex items-center gap-2">
            <ShipByDate
              date={card.displayShipByDate || ''}
              showPrefix={false}
              showYear={false}
              className="[&>span]:text-[15px] [&>span]:font-black [&>svg]:w-4 [&>svg]:h-4"
            />
            <span className={`text-[15px] font-black ${getDaysLateTone(card.daysLate)}`}>
              {card.daysLate}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-extrabold font-mono text-gray-900 px-1.5 py-0.5 rounded border border-gray-300">
              #{getOrderIdLast4(order.order_id)}
            </span>
            <PlatformExternalChip
              orderId={order.order_id}
              accountSource={order.account_source}
              canOpen={!!card.getExternalUrlByItemNumber(order.item_number)}
              onOpen={() => card.openExternalByItemNumber(order.item_number)}
            />
            <ChevronToggle isExpanded={isExpanded} />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-3">
          <h4 className="text-[17px] font-black text-gray-900 leading-tight">
            <InlineQtyPrefix quantity={card.quantity} />
            <span className={getConditionColor(order.condition)}>{order.condition || 'No Condition'}</span>
            {' '}{order.product_title}
          </h4>
        </div>

        {card.hasOutOfStock && (
          <div className="mt-2 border-t border-red-100 px-3 pt-2" onClick={(e) => e.stopPropagation()}>
            <OutOfStockField
              value={String(order.out_of_stock || '')}
              onEdit={() => onMissingPartsToggle(order.id)}
            />
          </div>
        )}

        {/* ── Action buttons / editors ── */}
        {(card.showActions || card.hasOutOfStock || showMissingPartsInput === order.id) && (
          <div className="px-3 mt-2.5 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {showMissingPartsInput === order.id && (
                <div onClick={(e) => e.stopPropagation()}>
                  <OutOfStockEditorBlock
                    value={missingPartsReason}
                    onChange={onMissingPartsReasonChange}
                    onCancel={onMissingPartsCancel}
                    onSubmit={() => onMissingPartsSubmit(order.id)}
                    autoFocus
                    className="pt-0.5"
                  />
                </div>
              )}
            </AnimatePresence>

            {!card.hasOutOfStock ? (
              card.showActions && (
                <div className="flex items-center gap-3">
                  <UpNextActionButton
                    onClick={(e) => { e.stopPropagation(); onMissingPartsToggle(order.id); }}
                    label="Out of Stock"
                    tone="red"
                    fullWidth
                    className="flex-1"
                  />
                  <UpNextActionButton
                    onClick={(e) => { e.stopPropagation(); onStart(order); }}
                    label="Start"
                    icon={<Play className="w-4 h-4" />}
                    tone="emerald"
                    fullWidth
                    className="flex-1"
                  />
                </div>
              )
            ) : (
              <UpNextActionButton
                onClick={(e) => { e.stopPropagation(); onStart(order); }}
                label="Start"
                icon={<Play className="w-4 h-4" />}
                tone="emerald"
                fullWidth
              />
            )}
          </div>
        )}

        {/* ── Expanded details ── */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-order"
              initial={framerPresence.collapseHeight.initial}
              animate={framerPresence.collapseHeight.animate}
              exit={framerPresence.collapseHeight.exit}
              transition={framerTransition.upNextCollapse}
              style={{ willChange: 'height, opacity' }}
              className="overflow-hidden"
            >
              <div className="mt-3 border-t border-emerald-100 px-3 pt-3" onClick={(e) => e.stopPropagation()}>
                <DetailGrid>
                  {/* Source */}
                  <DetailCell label="Source">
                    {order.account_source || 'Unknown'}
                  </DetailCell>

                  {/* Item # */}
                  <DetailCell label="Item #">
                    <div className="flex items-center justify-between gap-1">
                      <div className="min-w-0 break-words">
                        {card.itemNumberValue
                          ? getLast4(card.itemNumberValue)
                          : missingItemNumberLabel(order.order_id, order.account_source)}
                      </div>
                      <div className="flex items-center gap-1">
                        {card.itemNumberValue && (
                          <CopyIconButton
                            copied={card.copiedItemNumber}
                            onClick={card.handleCopyItemNumber}
                            ariaLabel={card.copiedItemNumber ? 'Item number copied' : 'Copy item number'}
                          />
                        )}
                        <ExternalLinkButton
                          onClick={(e) => {
                            e.stopPropagation();
                            if (card.itemNumberValue) card.openExternalByItemNumber(card.itemNumberValue);
                          }}
                          disabled={!card.itemNumberValue}
                          ariaLabel="Open item in external page"
                        />
                      </div>
                    </div>
                  </DetailCell>

                  {/* Tech */}
                  <DetailCell label="Tech">
                    <div className="flex items-center justify-between gap-1">
                      <span>{order.tester_name || 'Unassigned'}</span>
                      <button
                        onClick={card.openAssignment}
                        className="flex-shrink-0 h-11 w-11 flex items-center justify-center text-gray-400 active:text-emerald-600 active:scale-95 transition-transform"
                        aria-label="Edit assignment"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                    </div>
                  </DetailCell>

                  {/* Tracking */}
                  <DetailCell label="Tracking">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 break-words">
                        {card.trackingNumber ? getTrackingLast4(card.trackingNumber) : 'N/A'}
                      </div>
                      <div className="flex items-center gap-1">
                        {card.trackingNumber && (
                          <CopyIconButton
                            copied={card.copiedTracking}
                            onClick={card.handleCopyTracking}
                            ariaLabel={card.copiedTracking ? 'Tracking copied' : 'Copy tracking number'}
                          />
                        )}
                        <ExternalLinkButton
                          onClick={(e) => {
                            e.stopPropagation();
                            if (card.trackingUrl) window.open(card.trackingUrl, '_blank', 'noopener,noreferrer');
                          }}
                          disabled={!card.trackingUrl}
                          ariaLabel="Open tracking in external tab"
                        />
                      </div>
                    </div>
                  </DetailCell>
                </DetailGrid>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardShell>

      {/* Assignment overlay — portal */}
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
