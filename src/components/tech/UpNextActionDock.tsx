'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { Play, AlertCircle } from '@/components/Icons';
import { FloatingButton } from '@/design-system/primitives';
import {
  dispatchUpNextActionStart,
  dispatchUpNextActionOos,
} from '@/utils/events';
import type { Order } from '@/components/station/upnext/upnext-types';

interface UpNextActionDockProps {
  /**
   * The Order currently previewed in the workspace. The dock dispatches
   * action events that carry this row's ids; `UpNextOrder` listens and
   * routes to its existing handlers so side-effects (parent `onStart` →
   * scan resolver kick-off, `triggerGlobalRefresh` on OOS) match a
   * sidebar-originated action.
   */
  order: Order;
}

/**
 * Terminal action surface for the shipping preview workspace — a floating
 * `Start` CTA with an optional split menu for Out of Stock. Mirrors the
 * receiving unbox / triage / testing panes (`FloatingButton` docked to the
 * bottom of a relative host) instead of the legacy two-button sticky bar.
 *
 * Events out:
 *  - `tech-upnext-action-start` → starts the previewed order
 *  - `tech-upnext-action-oos-set` → marks the order out-of-stock with a reason
 *
 * Both are consumed by `UpNextOrder`, which already owns the API calls
 * and refresh logic.
 */
export function UpNextActionDock({ order }: UpNextActionDockProps) {
  const [showEditor, setShowEditor] = useState(false);
  const [reason, setReason] = useState(order.out_of_stock ?? '');
  const hasOutOfStock = Boolean((order.out_of_stock ?? '').trim());

  useEffect(() => {
    setShowEditor(false);
    setReason(order.out_of_stock ?? '');
  }, [order.id, order.out_of_stock]);

  const handleStart = () => {
    dispatchUpNextActionStart({
      orderId: order.id,
      shipping_tracking_number: order.shipping_tracking_number,
      order_id: order.order_id,
    });
  };

  const handleOosSubmit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    dispatchUpNextActionOos({ orderId: order.id, reason: trimmed });
    setShowEditor(false);
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {showEditor ? (
          <motion.div
            key="oos-editor"
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.upNextCollapse}
            className="pointer-events-none absolute inset-x-0 bottom-[calc(3.75rem+max(1rem,env(safe-area-inset-bottom)))] z-20 px-4 sm:px-6"
          >
            <div className="pointer-events-auto mx-auto w-full max-w-3xl">
              <div className="rounded-2xl bg-surface-card px-4 py-3 shadow-lg ring-1 ring-border-soft">
                <OutOfStockEditorBlock
                  value={reason}
                  onChange={setReason}
                  onCancel={() => {
                    setShowEditor(false);
                    setReason(order.out_of_stock ?? '');
                  }}
                  onSubmit={handleOosSubmit}
                  autoFocus
                />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <FloatingButton
        label="Start"
        onClick={handleStart}
        icon={<Play className="h-4 w-4 shrink-0" />}
        tone="emerald"
        maxWidth="max-w-3xl"
        fullWidth
        menuLabel="Order actions"
        menuTitle="More order actions"
        menu={[
          {
            label: hasOutOfStock ? 'Update Out of Stock' : 'Out of Stock',
            icon: <AlertCircle className="h-3.5 w-3.5 shrink-0" />,
            onClick: () => setShowEditor(true),
          },
        ]}
      />
    </>
  );
}
