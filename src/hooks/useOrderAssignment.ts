'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchDashboardAndStationRefresh } from '@/utils/events';

export type OrderAssignPayload = {
  orderId?: number;
  orderIds?: number[];
  testerId?: number | null;
  packerId?: number | null;
  shipByDate?: string | null;
  outOfStock?: string | null;
  notes?: string | null;
  shippingTrackingNumber?: string | null;
  itemNumber?: string | null;
  condition?: string | null;
};

export function useOrderAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: OrderAssignPayload) => {
      const res = await fetch('/api/orders/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update order assignment');
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped'] }),
      ]);
      dispatchDashboardAndStationRefresh();
    },
  });
}
