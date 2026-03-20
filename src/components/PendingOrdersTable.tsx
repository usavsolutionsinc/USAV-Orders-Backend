'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import StockZohoOrdersTable from '@/components/dashboard/StockZohoOrdersTable';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { fetchPendingOrdersData } from '@/lib/dashboard-table-data';
import { useAblyChannel } from '@/hooks/useAblyChannel';

export interface PendingOrdersTableProps {
  packedBy?: number;
  testedBy?: number;
}

type PendingStockFilter = 'all' | 'pending' | 'stock';

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

export default function PendingOrdersTable({
  packedBy,
  testedBy,
}: PendingOrdersTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const searchQuery = String(searchParams.get('search') || '').trim();
  const pendingFilterParam = searchParams.get('pendingFilter');
  const pendingFilter: PendingStockFilter =
    pendingFilterParam === 'stock'
      ? 'stock'
      : pendingFilterParam === 'pending'
        ? 'pending'
        : 'all';
  const shippedRedirectAttemptRef = useRef<string>('');
  const queryKey = ['dashboard-table', 'pending', { searchQuery, packedBy, testedBy }] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPendingOrdersData({
      searchQuery,
      packedBy,
      testedBy,
    }),
    staleTime: 60000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const ordersChannelName = process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES || 'orders:changes';

  useAblyChannel(
    ordersChannelName,
    'order.tested',
    (message: any) => {
      const orderId = Number(message?.data?.orderId);
      const testedByIdRaw = message?.data?.testedBy;
      const testedById = testedByIdRaw == null ? null : Number(testedByIdRaw);
      const normalizedTestedById = testedById != null && Number.isFinite(testedById) ? testedById : null;
      if (!Number.isFinite(orderId)) return;

      queryClient.setQueriesData(
        { queryKey: ['dashboard-table', 'pending'] },
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          let changed = false;
          const next = current.map((row: any) => {
            if (Number(row?.id) !== orderId) return row;
            changed = true;
            return {
              ...row,
              has_tech_scan: true,
              tested_by: normalizedTestedById ?? row?.tested_by ?? null,
            };
          });
          return changed ? next : current;
        }
      );
    },
    true,
  );

  useEffect(() => {
    if (pendingFilter === 'stock') return;
    if ((pathname || '/dashboard') !== '/dashboard') return;
    if (!searchQuery) {
      shippedRedirectAttemptRef.current = '';
      return;
    }
    if (query.isLoading || query.isFetching) return;
    if ((query.data || []).length > 0) return;
    if (shippedRedirectAttemptRef.current === searchQuery) return;

    let cancelled = false;

    const redirectToShippedIfNeeded = async () => {
      shippedRedirectAttemptRef.current = searchQuery;
      try {
        const params = new URLSearchParams({ q: searchQuery });
        const response = await fetch(`/api/shipped?${params.toString()}`);
        if (!response.ok || cancelled) return;
        const json = await response.json();
        const records = Array.isArray(json?.results)
          ? json.results
          : Array.isArray(json?.shipped)
            ? json.shipped
            : [];
        if (!records.length || cancelled) return;

        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.delete('pending');
        nextParams.delete('unshipped');
        nextParams.set('shipped', '');
        nextParams.set('search', searchQuery);
        if (records.length === 1) nextParams.set('openOrderId', String(records[0].id));
        else nextParams.delete('openOrderId');

        const nextSearch = nextParams.toString();
        router.replace(nextSearch ? `/dashboard?${nextSearch}` : '/dashboard');
      } catch {
        // Leave the pending empty state in place if the shipped lookup fails.
      }
    };

    void redirectToShippedIfNeeded();

    return () => {
      cancelled = true;
    };
  }, [pathname, pendingFilter, query.data, query.isFetching, query.isLoading, router, searchParams, searchQuery]);

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
    };

    // Patch order fields directly into cached rows when an assignment succeeds
    // so the deadline-driven pending view stays in sync without a round-trip.
    const handleAssignmentUpdated = (e: any) => {
      const {
        orderIds,
        testerId, packerId, testerName, packerName,
        deadlineAt, outOfStock, notes, itemNumber, condition,
      } = e?.detail || {};
      if (!Array.isArray(orderIds) || orderIds.length === 0) return;

      const hasAnyChange =
        testerId !== undefined || packerId !== undefined ||
        deadlineAt !== undefined || outOfStock !== undefined ||
        notes !== undefined || itemNumber !== undefined || condition !== undefined;
      if (!hasAnyChange) return;

      const idSet = new Set<number>(orderIds.map(Number));

      queryClient.setQueriesData(
        { queryKey: ['dashboard-table', 'pending'] },
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          let changed = false;
          const next = current.map((row: any) => {
            if (!idSet.has(Number(row?.id))) return row;
            changed = true;
            return patchOrderRecordFromAssignmentEvent(row, e?.detail);
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

  const allPendingRecords = query.data || [];
  const pendingUntestedRecords = allPendingRecords.filter(
    (record) => !Boolean((record as any).has_tech_scan)
  );

  if (pendingFilter === 'stock') {
    return (
      <StockZohoOrdersTable
        searchValue={searchQuery}
        onClearSearch={clearSearch}
      />
    );
  }

  return (
    <OrdersQueueTable
      records={pendingFilter === 'all' ? allPendingRecords : pendingUntestedRecords}
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      onClearSearch={clearSearch}
      emptyMessage={pendingFilter === 'all' ? 'No pending orders found' : 'No pending untested orders found'}
      useWaForDisplay
      onOpenRecord={(record) => {
        window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: record }));
      }}
      onCloseRecord={() => {
        dispatchCloseShippedDetails();
      }}
    />
  );
}
