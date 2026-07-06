'use client';

import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import {
  staggerRevealContainer,
  staggerRevealRiseItem,
  STAGGER_REVEAL_STEP,
} from '@/design-system/primitives/StaggerReveal';
import { Barcode, MapPin, Package } from '@/components/Icons';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderCloseButton,
} from '@/components/ui/pane-header';
import { OrderPackChecklist } from '@/components/packing/OrderPackChecklist';
import { LinkedTicketsPanel } from '@/components/linkage/LinkedTicketsPanel';
import { useOrderPackChecklist } from '@/hooks/useOrderPackChecklist';
import { usePackingPolicy } from '@/hooks/usePackingPolicy';
import { getLast4 } from '@/components/ui/CopyChip';
import type { PackActiveOrderPane } from '@/components/packer/usePackerOrderPane';

interface ActivePackerWorkspaceProps {
  activeOrder: PackActiveOrderPane;
  onClose: () => void;
}

/**
 * Focused pack work-item view in the /packer right pane. Crossfades over the
 * pack history table when the sidebar scan resolves an order — mirrors
 * ActiveOrderWorkspace on /tech.
 */
export function ActivePackerWorkspace({ activeOrder, onClose }: ActivePackerWorkspaceProps) {
  const reduceMotion = useReducedMotion();
  // Station crossfade through the reduced-motion bridge (see motion-crossfade.md):
  // reduced-motion collapses the y-slide to a pure opacity crossfade.
  const cardPresence = useMotionPresence(framerPresence.stationCard);
  const cardTransition = useMotionTransition(framerTransition.stationCardMount);
  const revealContainer = staggerRevealContainer(reduceMotion ? 0 : STAGGER_REVEAL_STEP);
  const revealItem: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.001 } } }
    : staggerRevealRiseItem;

  const { data: packingPolicy } = usePackingPolicy();
  const { data: checklist, isLoading } = useOrderPackChecklist({
    orderRowId: activeOrder.orderRowId,
    sku: activeOrder.sku,
    condition: activeOrder.condition,
    productTitle: activeOrder.productTitle,
    enabled: true,
  });

  const orderIdDisplay = activeOrder.orderId?.trim() || getLast4(activeOrder.tracking) || '—';
  const resetKey = activeOrder.orderRowId
    ? `row-${activeOrder.orderRowId}`
    : `${activeOrder.sku || activeOrder.tracking}`;

  return (
    <motion.div
      key={resetKey}
      initial={cardPresence.initial}
      animate={cardPresence.animate}
      exit={cardPresence.exit}
      transition={cardTransition}
      className="relative flex h-full w-full flex-col bg-surface-canvas"
    >
      <PaneHeader
        className="border-border-soft bg-surface-card"
        rowClassName="px-4"
        leftSlot={
          <>
            <PaneHeaderIconBadge
              Icon={activeOrder.scanType === 'SKU' ? Package : MapPin}
              bg="bg-surface-canvas"
              tint={activeOrder.scanType === 'SKU' ? 'text-emerald-600' : 'text-blue-600'}
              size="sm"
              rounded="lg"
            />
            <PaneHeaderLabel
              eyebrow={`Pack · ${activeOrder.scanType === 'SKU' ? 'SKU' : 'Order'}`}
              value={orderIdDisplay}
              valueTitle={orderIdDisplay}
              valueClassName="truncate text-sm font-black tracking-tight text-text-default"
            />
          </>
        }
        rightSlot={
          <>
            <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-eyebrow font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200 md:inline-flex">
              <Barcode className="h-3 w-3" />
              <span>Scan next</span>
            </span>
            <PaneHeaderCloseButton
              onClick={onClose}
              ariaLabel="Return to history"
              title="Return to history"
            />
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          initial="hidden"
          animate="show"
          variants={revealContainer}
          className="mx-auto w-full min-w-0 max-w-3xl space-y-4 px-4 py-5 pb-8 sm:px-6"
        >
          <motion.div variants={revealItem} className="rounded-2xl border border-border-soft bg-surface-card p-4 shadow-sm">
            <h2 className="text-base font-black leading-snug text-text-default">{activeOrder.productTitle}</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border-hairline bg-surface-canvas px-2.5 py-2">
                <dt className="text-eyebrow font-black uppercase tracking-wider text-text-faint">Qty</dt>
                <dd className="text-xs font-bold text-text-default">{activeOrder.qty}</dd>
              </div>
              <div className="rounded-xl border border-border-hairline bg-surface-canvas px-2.5 py-2">
                <dt className="text-eyebrow font-black uppercase tracking-wider text-text-faint">Condition</dt>
                <dd className="text-xs font-bold text-text-default">{activeOrder.condition}</dd>
              </div>
              <div className="rounded-xl border border-border-hairline bg-surface-canvas px-2.5 py-2">
                <dt className="text-eyebrow font-black uppercase tracking-wider text-text-faint">
                  {activeOrder.scanType === 'SKU' ? 'SKU' : 'Tracking'}
                </dt>
                <dd className="truncate font-mono text-xs font-bold text-text-default">
                  {activeOrder.scanType === 'SKU'
                    ? (activeOrder.sku || '—')
                    : getLast4(activeOrder.tracking) || '—'}
                </dd>
              </div>
            </dl>
          </motion.div>

          <motion.div variants={revealItem}>
            <OrderPackChecklist
              lines={checklist?.lines ?? []}
              enforcement={packingPolicy?.enforcement ?? checklist?.enforcement ?? 'advisory'}
              resetKey={resetKey}
              isLoading={isLoading}
              variant="panel"
            />
          </motion.div>

          <motion.div variants={revealItem} className="rounded-2xl border border-border-soft bg-surface-card p-3">
            <LinkedTicketsPanel
              order={activeOrder.orderId || undefined}
              tracking={activeOrder.tracking || undefined}
              dense
            />
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
