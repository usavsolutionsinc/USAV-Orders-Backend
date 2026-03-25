'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { fetchUnshippedOrdersData } from '@/lib/dashboard-table-data';
import { useAblyChannel } from '@/hooks/useAblyChannel';

export interface UnshippedTableProps {
  packedBy?: number;
  testedBy?: number;
}

function patchOrderRecordFromAssignmentEvent(row: any, detail: any) {
  const patched = { ...row };
  const {
    testerId,
    packerId,
    testerName,
    packerName,
    deadlineAt,
    outOfStock,
    notes,
    itemNumber,
    condition,
  } = detail || {};

  if (testerId !== undefined) {
    patched.tester_id = testerId;
    patched.tester_name = testerName ?? null;
    patched.tested_by_name = testerName ?? null;
  }
  if (packerId !== undefined) {
    patched.packer_id = packerId;
    patched.packer_name = packerName ?? null;
    patched.packed_by_name = packerName ?? null;
  }
  if (deadlineAt !== undefined) patched.deadline_at = deadlineAt;
  if (outOfStock !== undefined) patched.out_of_stock = outOfStock;
  if (notes !== undefined) patched.notes = notes;
  if (itemNumber !== undefined) patched.item_number = itemNumber;
  if (condition !== undefined) patched.condition = condition;

  return patched;
}

export function UnshippedTable({
  packedBy,
  testedBy,
}: UnshippedTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const searchQuery = String(searchParams.get('search') || '').trim();
  const queryKey = ['dashboard-table', 'unshipped', { searchQuery, packedBy, testedBy }] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchUnshippedOrdersData({ searchQuery, packedBy, testedBy }),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const ordersChannelName = process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES || 'orders:changes';

  useAblyChannel(
    ordersChannelName,
    'order.assignments',
    (message: any) => {
      const d = message?.data;
      const orderId = Number(d?.orderId);
      if (!Number.isFinite(orderId)) return;

      const detail = {
        orderIds: [orderId],
        testerId: d.testerId,
        packerId: d.packerId,
        testerName: d.testerName,
        packerName: d.packerName,
        deadlineAt: d.deadlineAt,
      };

      const hasAnyChange =
        detail.testerId !== undefined ||
        detail.packerId !== undefined ||
        detail.deadlineAt !== undefined;
      if (!hasAnyChange) return;

      queryClient.setQueriesData(
        { queryKey: ['dashboard-table', 'unshipped'] },
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          let changed = false;
          const next = current.map((row: any) => {
            if (Number(row?.id) !== orderId) return row;
            changed = true;
            return patchOrderRecordFromAssignmentEvent(row, detail);
          });
          return changed ? next : current;
        }
      );
    },
    true,
  );

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
    };
    const handleAssignmentUpdated = (e: any) => {
      const detail = e?.detail || {};
      const orderIds = Array.isArray(detail.orderIds) ? detail.orderIds : [];
      if (orderIds.length === 0) return;

      const hasAnyChange =
        detail.testerId !== undefined ||
        detail.packerId !== undefined ||
        detail.deadlineAt !== undefined ||
        detail.outOfStock !== undefined ||
        detail.notes !== undefined ||
        detail.itemNumber !== undefined ||
        detail.condition !== undefined;
      if (!hasAnyChange) return;

      const idSet = new Set<number>(orderIds.map(Number));
      queryClient.setQueriesData(
        { queryKey: ['dashboard-table', 'unshipped'] },
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          let changed = false;
          const next = current.map((row: any) => {
            if (!idSet.has(Number(row?.id))) return row;
            changed = true;
            return patchOrderRecordFromAssignmentEvent(row, detail);
          });
          return changed ? next : current;
        }
      );
    };

    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);
    window.addEventListener('order-assignment-updated' as any, handleAssignmentUpdated as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
      window.removeEventListener('order-assignment-updated' as any, handleAssignmentUpdated as any);
    };
  }, [queryClient]);

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  };

  return (
    <OrdersQueueTable
      records={query.data || []}
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      onClearSearch={clearSearch}
      emptyMessage="No unshipped order records found"
      onOpenRecord={(record) => {
        window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: record }));
      }}
      onCloseRecord={() => {
        dispatchCloseShippedDetails();
      }}
    />
  );
}
