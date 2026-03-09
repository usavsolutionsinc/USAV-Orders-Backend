'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderRecordsTable } from '@/components/shipped/OrderRecordsTable';
import { fetchPendingOrdersData } from '@/lib/dashboard-table-data';
import { useAblyChannel } from '@/hooks/useAblyChannel';

export interface PendingOrdersTableProps {
  packedBy?: number;
  testedBy?: number;
}

type FilterMode = 'all' | 'pending' | 'stock';

export default function PendingOrdersTable({
  packedBy,
  testedBy,
}: PendingOrdersTableProps = {}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const queryClient = useQueryClient();

  // 'pending' mode fetches server-filtered data (SQL: no out_of_stock + not in tech_serial_numbers).
  // 'all' and 'stock' share the same base fetch and filter client-side for 'stock'.
  const isPendingMode = filterMode === 'pending';
  const queryKey = ['dashboard-table', 'pending', { searchQuery, packedBy, testedBy, isPendingMode }] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPendingOrdersData({
      searchQuery,
      packedBy,
      testedBy,
      pendingOnly: isPendingMode,
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
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
    };
    const handleDashboardSearch = (e: any) => {
      setSearchQuery(String(e?.detail?.query || '').trim());
    };
    const handlePendingFilter = (e: any) => {
      const mode = String(e?.detail?.mode || 'all').toLowerCase();
      if (mode === 'stock') setFilterMode('stock');
      else if (mode === 'pending') setFilterMode('pending');
      else setFilterMode('all');
    };

    // Patch assigned_tech_id / assigned_packer_id directly into cached rows when an
    // assignment succeeds — no full refetch needed, bypasses the Upstash cache.
    const handleAssignmentUpdated = (e: any) => {
      const { orderIds, testerId, packerId, testerName, packerName } = e?.detail || {};
      if (!Array.isArray(orderIds) || orderIds.length === 0) return;
      if (testerId === undefined && packerId === undefined) return;

      const idSet = new Set<number>(orderIds.map(Number));

      queryClient.setQueriesData(
        { queryKey: ['dashboard-table', 'pending'] },
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          let changed = false;
          const next = current.map((row: any) => {
            if (!idSet.has(Number(row?.id))) return row;
            changed = true;
            const patched = { ...row };
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
            return patched;
          });
          return changed ? next : current;
        }
      );
    };

    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);
    window.addEventListener('dashboard-search' as any, handleDashboardSearch as any);
    window.addEventListener('dashboard-pending-filter' as any, handlePendingFilter as any);
    window.addEventListener('order-assignment-updated' as any, handleAssignmentUpdated as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
      window.removeEventListener('dashboard-search' as any, handleDashboardSearch as any);
      window.removeEventListener('dashboard-pending-filter' as any, handlePendingFilter as any);
      window.removeEventListener('order-assignment-updated' as any, handleAssignmentUpdated as any);
    };
  }, [queryClient]);

  const clearSearch = () => {
    setSearchQuery('');
    window.dispatchEvent(new CustomEvent('dashboard-search', { detail: { query: '' } }));
  };

  // 'pending' is already filtered server-side. 'stock' is a simple client-side check.
  const records = (query.data || []).filter((record) => {
    if (filterMode === 'stock') return String((record as any).out_of_stock || '').trim() !== '';
    return true;
  });

  return (
    <OrderRecordsTable
      records={records}
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      ordersOnly
      onClearSearch={clearSearch}
      emptyMessage="No pending order records found"
    />
  );
}
