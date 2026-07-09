'use client';

/**
 * Right-pane order state for the packer dashboard: a scanned/active order
 * crossfades over the pack history table (mirrors useTechOrderPanes).
 */

import { useEffect, useState } from 'react';

/**
 * How long a scanned/active order stays on the packer right pane before it
 * auto-crossfades back to the history table. Mirrors the Station act-and-clear
 * auto-hide (`COMPLETED_ORDER_AUTO_HIDE_MS` in `useStationTestingController`);
 * the crossfade itself stays fast (`framerTransition.stationCardMount`, 0.26s)
 * — this is the *dwell*, not the animation length (see
 * `.claude/rules/display/station.md` §5 and `motion-crossfade.md`).
 */
const ACTIVE_ORDER_AUTO_HIDE_MS = 2 * 60 * 1000;

export interface PackActiveOrderPane {
  orderRowId: number | null;
  orderId: string;
  productTitle: string;
  qty: number;
  condition: string;
  tracking: string;
  sku?: string;
  scanType?: 'ORDERS' | 'SKU' | 'REPAIR';
}

export function usePackerOrderPane() {
  const [activeOrderPane, setActiveOrderPane] = useState<PackActiveOrderPane | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PackActiveOrderPane | null>).detail;
      setActiveOrderPane(detail || null);
    };
    window.addEventListener('pack-active-order-changed', handler);
    return () => window.removeEventListener('pack-active-order-changed', handler);
  }, []);

  // Act-and-clear dwell: hold the active order for 2 minutes, then clear it so
  // `PackerRightPane` crossfades back to the history table. Every scan dispatches
  // a fresh pane object, so this effect re-runs and restarts the 2-minute window
  // (a new scan still replaces the card immediately). Manual close / unmount
  // clears the timer via cleanup.
  useEffect(() => {
    if (!activeOrderPane) return;
    const timer = setTimeout(() => setActiveOrderPane(null), ACTIVE_ORDER_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [activeOrderPane]);

  return { activeOrderPane, setActiveOrderPane };
}

export function dispatchPackActiveOrder(detail: PackActiveOrderPane | null) {
  window.dispatchEvent(new CustomEvent('pack-active-order-changed', { detail }));
}
