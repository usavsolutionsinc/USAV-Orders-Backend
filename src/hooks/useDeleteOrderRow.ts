'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';

export type DeleteOrderRowPayload =
  | { rowSource?: 'order'; orderId?: number; orderIds?: number[] }
  | { rowSource: 'exception'; exceptionId?: number; exceptionIds?: number[] };

export function useDeleteOrderRow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: DeleteOrderRowPayload) => {
      const isException = payload.rowSource === 'exception';
      const endpoint = isException ? '/api/orders-exceptions/delete' : '/api/orders/delete';
      const body = isException
        ? { exceptionId: payload.exceptionId, exceptionIds: payload.exceptionIds }
        : { orderId: payload.orderId, orderIds: payload.orderIds };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete row');
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped'] }),
      ]);
      dispatchDashboardAndStationRefresh();
      dispatchCloseShippedDetails();
    },
  });
}
