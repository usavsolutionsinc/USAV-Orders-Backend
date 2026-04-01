'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { dispatchCloseShippingEditCard } from '@/utils/events';

interface ShippingEditCardState {
  isOpen: boolean;
  orders: ShippedOrder[];
  startIndex: number;
  close: () => void;
}

export function useShippingEditCard(): ShippingEditCardState {
  const [isOpen, setIsOpen] = useState(false);
  const [orders, setOrders] = useState<ShippedOrder[]>([]);
  const [startIndex, setStartIndex] = useState(0);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.orders || !Array.isArray(detail.orders)) return;
      setOrders(detail.orders);
      setStartIndex(Math.max(0, Number(detail.startIndex) || 0));
      setIsOpen(true);
    };

    const handleClose = () => {
      setIsOpen(false);
    };

    window.addEventListener('open-shipping-edit-card', handleOpen);
    window.addEventListener('close-shipping-edit-card', handleClose);
    return () => {
      window.removeEventListener('open-shipping-edit-card', handleOpen);
      window.removeEventListener('close-shipping-edit-card', handleClose);
    };
  }, []);

  const close = useCallback(() => {
    dispatchCloseShippingEditCard();
  }, []);

  return { isOpen, orders, startIndex, close };
}
