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
import { Barcode, MapPin, Package, Settings } from '@/components/Icons';
import {
  PaneHeader,
  PaneHeaderIconBadge,
  PaneHeaderLabel,
  PaneHeaderCloseButton,
} from '@/components/ui/pane-header';
import type { ActiveStationOrder } from '@/hooks/useStationTestingController';
import type { Order } from '@/components/station/upnext/upnext-types';
import { receivingHeaderHairlineClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';
import { UpNextActionDock } from './UpNextActionDock';
import { OrderPreviewPanel } from './OrderPreviewPanel';
import { ActiveOrderBody } from './ActiveOrderBody';

interface ActiveOrderWorkspaceProps {
  activeOrder: ActiveStationOrder;
  onClose: () => void;
  onRemoveSerial?: (serial: string, index: number) => Promise<void> | void;
  /**
   * `active` — order has been scanned and is in progress (default).
   * `preview` — user clicked an Up Next card to inspect it; nothing has been
   *  scanned yet. Header changes to "Preview" and the action dock mounts at
   *  the bottom so Start / Out of Stock are reachable here (they no longer
   *  live on the sidebar card).
   */
  mode?: 'active' | 'preview';
  /**
   * Original `Order` row backing the preview. Required in preview mode so
   * `UpNextActionDock` can dispatch action events with the right ids
   * (`ActiveStationOrder` doesn't carry the numeric row id).
   */
  previewOrder?: Order;
}

function getVariantIcon(activeOrder: ActiveStationOrder) {
  const source = activeOrder.sourceType;
  if (source === 'fba') return { Icon: Package, tint: 'text-purple-600', label: 'FBA' };
  if (source === 'repair') return { Icon: Settings, tint: 'text-amber-600', label: 'Repair' };
  if ((activeOrder.tracking || '').toUpperCase().startsWith('RS-')) {
    return { Icon: Settings, tint: 'text-amber-600', label: 'Repair' };
  }
  return { Icon: MapPin, tint: 'text-blue-600', label: 'Order' };
}

/**
 * Focused work-item view rendered in the `/tech` right pane while an order is
 * active. Crossfades in over the global `TechTable` history (see TechDashboard)
 * — this is the master-detail "detail" surface for the tech station.
 *
 * The scan bar lives in the sidebar and stays focused; this surface should not
 * steal focus. Closing returns the pane to the history view.
 *
 * Preview mode reuses the receiving triage / testing workspace shell: a
 * stagger-revealed card column with bottom padding for the floating CTA.
 */
export function ActiveOrderWorkspace({
  activeOrder,
  onClose,
  onRemoveSerial,
  mode = 'active',
  previewOrder,
}: ActiveOrderWorkspaceProps) {
  const { Icon, tint, label } = getVariantIcon(activeOrder);
  const trackingDisplay = (activeOrder.tracking || '').trim() || '—';
  const orderIdDisplay = (activeOrder.orderId || '').trim() || trackingDisplay;
  const isPreview = mode === 'preview';
  const stateLabel = isPreview ? 'Preview' : 'Active';
  const reduceMotion = useReducedMotion();
  // Station crossfade — route the active-card preset through the reduced-motion
  // bridge so `prefers-reduced-motion` collapses the y-slide to a pure opacity
  // crossfade automatically (motion-crossfade.md: don't consume framerPresence.*
  // raw on a user-facing surface). The parent `TechRightPane` owns the
  // `AnimatePresence mode="wait"` + stable per-entity key.
  const cardPresence = useMotionPresence(framerPresence.stationCard);
  const cardTransition = useMotionTransition(framerTransition.stationCardMount);
  const revealContainer = staggerRevealContainer(reduceMotion ? 0 : STAGGER_REVEAL_STEP);
  const revealItem: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.001 } } }
    : staggerRevealRiseItem;

  return (
    <motion.div
      key={activeOrder.tracking || activeOrder.orderId}
      initial={cardPresence.initial}
      animate={cardPresence.animate}
      exit={cardPresence.exit}
      transition={cardTransition}
      className="relative flex h-full w-full flex-col bg-surface-canvas"
    >
      <PaneHeader
        className={cn(
          'bg-surface-card',
          isPreview
            ? cn('border-b-0', receivingHeaderHairlineClass)
            : 'border-border-soft',
        )}
        rowClassName="px-4"
        leftSlot={
          <>
            <PaneHeaderIconBadge Icon={Icon} bg="bg-surface-canvas" tint={tint} size="sm" rounded="lg" />
            <PaneHeaderLabel
              eyebrow={`${label} · ${stateLabel}`}
              value={orderIdDisplay}
              valueTitle={orderIdDisplay}
              valueClassName="truncate text-sm font-black tracking-tight text-text-default"
            />
          </>
        }
        rightSlot={
          <>
            {!isPreview && (
              <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-eyebrow font-black uppercase tracking-widest text-emerald-600 ring-1 ring-inset ring-emerald-200 md:inline-flex">
                <Barcode className="h-3 w-3" />
                <span>Scan next</span>
              </span>
            )}
            <PaneHeaderCloseButton
              onClick={onClose}
              ariaLabel="Return to history"
              title="Return to history"
            />
          </>
        }
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <motion.div
            initial="hidden"
            animate="show"
            variants={revealContainer}
            className="mx-auto w-full min-w-0 max-w-3xl space-y-4 px-4 py-5 pb-32 sm:px-6"
          >
            {isPreview && previewOrder ? (
              <OrderPreviewPanel order={previewOrder} revealItem={revealItem} />
            ) : (
              <ActiveOrderBody
                activeOrder={activeOrder}
                onRemoveSerial={onRemoveSerial}
                revealItem={revealItem}
              />
            )}
          </motion.div>
        </div>

        {isPreview && previewOrder ? <UpNextActionDock order={previewOrder} /> : null}
      </div>
    </motion.div>
  );
}
