'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchCloseShippedDetails, dispatchDashboardAndStationRefresh } from '@/utils/events';

export type DeleteOrderRowPayload =
  | { rowSource?: 'order'; orderId?: number; orderIds?: number[] }
  | { rowSource: 'exception'; exceptionId?: number; exceptionIds?: number[] }
  | { rowSource: 'packing_log'; packerLogId?: number; activityLogId?: number };

export function useDeleteOrderRow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: DeleteOrderRowPayload) => {
      const isException = payload.rowSource === 'exception';
      const isPackingLog = payload.rowSource === 'packing_log';
      if (isPackingLog && payload.activityLogId == null && payload.packerLogId == null) {
        throw new Error('packerLogId or activityLogId is required');
      }

      const endpoint = isPackingLog
        ? `/api/packerlogs?${(payload.activityLogId != null
            ? new URLSearchParams({ activityLogId: String(payload.activityLogId) })
            : new URLSearchParams({ id: String(payload.packerLogId ?? '') })
          ).toString()}`
        : isException
          ? '/api/orders-exceptions/delete'
          : '/api/orders/delete';

      const body = isPackingLog
        ? undefined
        : isException
          ? { exceptionId: payload.exceptionId, exceptionIds: payload.exceptionIds }
          : { orderId: payload.orderId, orderIds: payload.orderIds };

      const res = await fetch(endpoint, {
        method: isPackingLog ? 'DELETE' : 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to delete row');
      }
      if (!isException && !isPackingLog && Number(data?.deleted || 0) <= 0) {
        throw new Error('No matching order row was deleted');
      }
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] }),
        queryClient.invalidateQueries({ queryKey: ['shipped-table'] }),
      ]);
      dispatchDashboardAndStationRefresh();
      dispatchCloseShippedDetails();
    },
  });
}
