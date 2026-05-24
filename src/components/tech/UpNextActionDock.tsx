'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { OutOfStockEditorBlock } from '@/components/ui/OutOfStockEditorBlock';
import { Play, AlertCircle } from '@/components/Icons';
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
 * Action surface for the right-pane preview workspace — replaces the
 * Start / Out of Stock buttons that used to live inline on the sidebar
 * `OrderCard`. Moving actions here keeps the card calm and makes the
 * action target unambiguous: the workspace shows the order, the dock
 * acts on it.
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
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-gray-200 bg-white/95 backdrop-blur-md">
      {/* OOS editor — opens in the dock when the secondary action is toggled.
          Uses the same primitive the card used to host inline. */}
      <AnimatePresence initial={false}>
        {showEditor && (
          <motion.div
            key="oos-editor"
            initial={framerPresence.collapseHeight.initial}
            animate={framerPresence.collapseHeight.animate}
            exit={framerPresence.collapseHeight.exit}
            transition={framerTransition.upNextCollapse}
            className="overflow-hidden"
          >
            <div className="mx-auto w-full max-w-2xl px-4 pt-3 pb-1">
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action row — primary Start (emerald, full-width on the right),
          secondary Out of Stock (red ghost). Layout mirrors `StickyActionBar`
          but uses the order-card visual language so both surfaces feel
          related. */}
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setShowEditor((v) => !v)}
          className={`inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border text-label font-black uppercase tracking-widest transition-colors ${
            hasOutOfStock || showEditor
              ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
              : 'border-red-200 bg-white text-red-600 hover:bg-red-50'
          }`}
        >
          <AlertCircle className="h-4 w-4" />
          <span>{hasOutOfStock ? 'Update Out of Stock' : 'Out of Stock'}</span>
        </button>
        <button
          type="button"
          onClick={handleStart}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-label font-black uppercase tracking-widest text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(6,95,70,0.34)] transition-colors hover:bg-emerald-700"
        >
          <Play className="h-4 w-4" />
          <span>Start</span>
        </button>
      </div>
    </div>
  );
}
