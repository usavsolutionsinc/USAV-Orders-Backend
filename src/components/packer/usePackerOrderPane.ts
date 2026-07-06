'use client';

/**
 * Right-pane order state for the packer dashboard: a scanned/active order
 * crossfades over the pack history table (mirrors useTechOrderPanes).
 */

import { useEffect, useState } from 'react';

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

  return { activeOrderPane, setActiveOrderPane };
}

export function dispatchPackActiveOrder(detail: PackActiveOrderPane | null) {
  window.dispatchEvent(new CustomEvent('pack-active-order-changed', { detail }));
}
