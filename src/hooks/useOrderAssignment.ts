'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

export type OrderAssignPayload = {
  orderId?: number;
  orderIds?: number[];
  orderNumber?: string | null;
  testerId?: number | null;
  packerId?: number | null;
  testerName?: string | null;
  packerName?: string | null;
  shipByDate?: string | null;
  outOfStock?: string | null;
  notes?: string | null;
  shippingTrackingNumber?: string | null;
  itemNumber?: string | null;
  condition?: string | null;
  quantity?: string | null;
  sku?: string | null;
  performedByStaffId?: number | null;
};

export function useOrderAssignment() {
  const queryClient = useQueryClient();

  const applyOptimisticUpdate = (current: any, payload: OrderAssignPayload) => {
    if (!current) return current;

    const idsToUpdate = new Set(
      (payload.orderId ? [payload.orderId] : payload.orderIds || []).filter((id): id is number => Number.isFinite(id))
    );
    if (idsToUpdate.size === 0) return current;

    const patchRow = (row: any) => {
      if (!row || !idsToUpdate.has(Number(row.id))) return row;
      const next = { ...row };

      if (payload.testerId !== undefined) {
        next.tester_id = payload.testerId;
        next.tested_by = payload.testerId;
        next.testerId = payload.testerId;
        if (payload.testerName !== undefined) {
          next.tested_by_name = payload.testerName;
          next.tester_name = payload.testerName;
        }
      }
      if (payload.packerId !== undefined) {
        next.packer_id = payload.packerId;
        next.packed_by = payload.packerId;
        next.packerId = payload.packerId;
        if (payload.packerName !== undefined) {
          next.packed_by_name = payload.packerName;
          next.packer_name = payload.packerName;
        }
      }
      if (payload.shipByDate !== undefined) {
        next.ship_by_date = payload.shipByDate;
        next.shipByDate = payload.shipByDate;
      }
      if (payload.orderNumber !== undefined) {
        next.order_id = payload.orderNumber;
        next.orderId = payload.orderNumber;
      }
      if (payload.outOfStock !== undefined) {
        next.out_of_stock = payload.outOfStock;
        next.outOfStock = payload.outOfStock;
      }
      if (payload.notes !== undefined) {
        next.notes = payload.notes;
      }
      if (payload.shippingTrackingNumber !== undefined) {
        next.shipping_tracking_number = payload.shippingTrackingNumber;
        next.shippingTrackingNumber = payload.shippingTrackingNumber;
      }
      if (payload.itemNumber !== undefined) {
        next.item_number = payload.itemNumber;
        next.itemNumber = payload.itemNumber;
      }
      if (payload.condition !== undefined) {
        next.condition = payload.condition;
      }
      if (payload.quantity !== undefined) {
        next.quantity = payload.quantity;
      }
      if (payload.sku !== undefined) {
        next.sku = payload.sku;
      }

      return next;
    };

    if (Array.isArray(current)) {
      return current.map(patchRow);
    }

    if (Array.isArray(current?.orders)) {
      return { ...current, orders: current.orders.map(patchRow) };
    }

    if (Array.isArray(current?.results)) {
      return { ...current, results: current.results.map(patchRow) };
    }

    if (Array.isArray(current?.shipped)) {
      return { ...current, shipped: current.shipped.map(patchRow) };
    }

    return current;
  };

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
    onMutate: async (payload) => {
      const keysToPatch = [['orders'], ['shipped'], ['dashboard-table']];
      const snapshots: Array<{ key: readonly unknown[]; data: any }> = [];

      keysToPatch.forEach((key) => {
        const existing = queryClient.getQueriesData({ queryKey: key });
        existing.forEach(([queryKey, data]) => {
          snapshots.push({ key: queryKey, data });
          queryClient.setQueryData(queryKey, (current: any) => applyOptimisticUpdate(current, payload));
        });
      });

      return { snapshots, payload };
    },
    onError: (_error, _payload, context) => {
      context?.snapshots?.forEach((snapshot) => {
        queryClient.setQueryData(snapshot.key, snapshot.data);
      });
    },
    onSuccess: (_data, payload) => {
      if (typeof window === 'undefined') return;
      const orderIds = payload.orderId ? [payload.orderId] : payload.orderIds || [];
      window.dispatchEvent(
        new CustomEvent('order-assignment-updated', {
          detail: {
            orderIds,
            testerId: payload.testerId,
            packerId: payload.packerId,
            testerName: payload.testerName,
            packerName: payload.packerName,
            orderNumber: payload.orderNumber,
            shipByDate: payload.shipByDate,
            outOfStock: payload.outOfStock,
            notes: payload.notes,
            shippingTrackingNumber: payload.shippingTrackingNumber,
            itemNumber: payload.itemNumber,
            condition: payload.condition,
          },
        })
      );
    },
  });
}
