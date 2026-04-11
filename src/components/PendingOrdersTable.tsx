'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getOrdersChannelName } from '@/lib/realtime/channels';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import StockZohoOrdersTable from '@/components/dashboard/StockZohoOrdersTable';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails } from '@/utils/events';
import { fetchPendingOrderRowById, fetchPendingOrdersData } from '@/lib/dashboard-table-data';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { readPendingFilterPreference, writePendingFilterPreference } from '@/utils/dashboard-preferences';

export interface PendingOrdersTableProps extends DashboardSearchSectionProps {
  packedBy?: number;
  testedBy?: number;
  overridePendingFilter?: PendingStockFilter;
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
  overridePendingFilter,
  strictSearchScope = false,
  bannerTitle,
  bannerSubtitle,
  searchEmptyTitle,
  searchResultLabel,
  clearSearchLabel,
}: PendingOrdersTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const searchQuery = String(searchParams.get('search') || '').trim();
  const pendingFilterParam = searchParams.get('pendingFilter');
  const pendingFilter: PendingStockFilter = useMemo(() => {
    if (overridePendingFilter) return overridePendingFilter;
    if (pendingFilterParam === 'stock') return 'stock';
    if (pendingFilterParam === 'pending') return 'pending';
    return readPendingFilterPreference() ?? 'all';
  }, [overridePendingFilter, pendingFilterParam]);
  const queryKey = ['dashboard-table', 'pending', { searchQuery, packedBy, testedBy, strictSearchScope }] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPendingOrdersData({
      searchQuery,
      packedBy,
      testedBy,
      strictSearchScope,
    }),
    staleTime: 60000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });

  const ordersChannelName = getOrdersChannelName();

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
        { queryKey: ['dashboard-table', 'pending'] },
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

  // When orders are created/updated/deleted (e.g. Google Sheets transfer),
  // refetch the full pending list so all clients stay in sync.
  useAblyChannel(
    ordersChannelName,
    'order.changed',
    () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
    },
    true,
  );

  useEffect(() => {
    writePendingFilterPreference(pendingFilter);
  }, [pendingFilter]);

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
    };

    const handlePendingOrderRefetch = (e: Event) => {
      const orderId = Number((e as CustomEvent<{ orderId?: number }>)?.detail?.orderId);
      if (!Number.isFinite(orderId) || orderId <= 0) return;

      void (async () => {
        try {
          const fresh = await fetchPendingOrderRowById(orderId, {
            searchQuery,
            packedBy,
            testedBy,
          });
          queryClient.setQueriesData(
            { queryKey: ['dashboard-table', 'pending'] },
            (current: unknown) => {
              if (!Array.isArray(current)) return current;
              const ix = current.findIndex((row: { id?: unknown }) => Number(row?.id) === orderId);
              if (fresh == null) {
                if (ix < 0) return current;
                return current.filter((row: { id?: unknown }) => Number(row?.id) !== orderId);
              }
              if (ix < 0) return [...current, fresh];
              const next = [...current];
              next[ix] = fresh;
              return next;
            }
          );
        } catch {
          // Keep existing cache on failure
        }
      })();
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
    window.addEventListener('dashboard-pending-order-refetch' as any, handlePendingOrderRefetch as any);
    window.addEventListener('order-assignment-updated' as any, handleAssignmentUpdated as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
      window.removeEventListener('dashboard-pending-order-refetch' as any, handlePendingOrderRefetch as any);
      window.removeEventListener('order-assignment-updated' as any, handleAssignmentUpdated as any);
    };
  }, [queryClient, packedBy, searchQuery, strictSearchScope, testedBy]);

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
  const pendingSearchEmptyTitle =
    searchEmptyTitle
      ?? (pendingFilter === 'all' ? 'No pending orders found' : 'No pending untested orders found');
  const pendingSearchResultLabel =
    searchResultLabel
      ?? (pendingFilter === 'all' ? 'pending orders' : 'pending untested orders');
  const pendingClearSearchLabel =
    clearSearchLabel
      ?? (pendingFilter === 'all' ? 'Show All Pending Orders' : 'Show All Pending Untested Orders');

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
      searchEmptyTitle={pendingSearchEmptyTitle}
      searchResultLabel={pendingSearchResultLabel}
      clearSearchLabel={pendingClearSearchLabel}
      bannerTitle={bannerTitle}
      bannerSubtitle={bannerSubtitle}
      useWaForDisplay
      onOpenRecord={(record) => {
        dispatchOpenShippedDetails(record, 'queue');
      }}
      onCloseRecord={() => {
        dispatchCloseShippedDetails();
      }}
    />
  );
}
