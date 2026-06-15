'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getOrdersChannelName, safeChannelName } from '@/lib/realtime/channels';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails } from '@/utils/events';
import { unshippedOrdersQuery } from '@/lib/queries/dashboard-queries';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { deriveUnshippedState } from '@/lib/unshipped-state';

export interface UnshippedTableProps extends DashboardSearchSectionProps {
  packedBy?: number;
  testedBy?: number;
  /** Pencil multi-select: rows render checkboxes; the page owns the action bar. */
  selectMode?: boolean;
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
  if (detail.shippingTrackingNumber !== undefined) patched.shipping_tracking_number = detail.shippingTrackingNumber;

  return patched;
}

export function UnshippedTable({
  packedBy,
  testedBy,
  strictSearchScope = false,
  bannerTitle,
  bannerSubtitle,
  searchEmptyTitle = 'No orders found',
  searchResultLabel = 'unshipped orders',
  clearSearchLabel = 'Show All Unshipped Orders',
  selectMode = false,
}: UnshippedTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const searchQuery = String(searchParams.get('search') || '').trim();
  // Merged Unshipped mode covers stages: Awaiting (no shipment_id → needs
  // tracking), Pending (has shipment, not yet packed), and Tested (the pending
  // subset already tech-tested / currently packing). The FilterRefinementBar
  // writes `?stage`; default `all` shows everything.
  const stageParam = String(searchParams.get('stage') || 'all').toLowerCase();
  const stageFilter: 'all' | 'awaiting' | 'pending' | 'tested' =
    stageParam === 'awaiting' ? 'awaiting'
      : stageParam === 'pending' ? 'pending'
        : stageParam === 'tested' ? 'tested'
          : 'all';
  // Sort order from the sidebar Sort control (`?sort`); default keeps priority.
  const sortParam = String(searchParams.get('sort') || 'priority').toLowerCase();
  const sortOrder: 'priority' | 'newest' = sortParam === 'newest' ? 'newest' : 'priority';
  // Click-to-filter from the status legend (`?ustatus`) — exact derived pre-dock
  // state. Composes on top of the coarse `?stage` facet.
  const statusFilter = String(searchParams.get('ustatus') || '').trim().toUpperCase();
  const query = useQuery({
    ...unshippedOrdersQuery({ searchQuery, packedBy, testedBy, strictSearchScope }),
    placeholderData: (previousData) => previousData,
  });

  const ordersChannelName = safeChannelName(() => getOrdersChannelName(orgId!));

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
        shippingTrackingNumber: d.shippingTrackingNumber,
      };

      const hasAnyChange =
        detail.testerId !== undefined ||
        detail.packerId !== undefined ||
        detail.deadlineAt !== undefined ||
        detail.shippingTrackingNumber !== undefined;
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
    !!ordersChannelName,
  );

  // Pending-stage rows live in this merged queue too, so reflect tech-test
  // verdicts (has_tech_scan) in place — same patch the old Pending table did.
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
        { queryKey: ['dashboard-table', 'unshipped'] },
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
    !!ordersChannelName,
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
        detail.condition !== undefined ||
        detail.shippingTrackingNumber !== undefined;
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

  const allRecords = query.data || [];
  const stageRecords = (() => {
    switch (stageFilter) {
      case 'awaiting':
        return allRecords.filter((r) => r.shipment_id == null);
      case 'pending':
        return allRecords.filter((r) => r.shipment_id != null);
      case 'tested':
        // Pending subset that's already tech-tested (has_tech_scan) → "currently packing".
        return allRecords.filter(
          (r) => r.shipment_id != null && Boolean((r as { has_tech_scan?: boolean }).has_tech_scan),
        );
      default:
        return allRecords;
    }
  })();
  // Legend chip filter: keep only rows whose exact derived state matches.
  const records = statusFilter
    ? stageRecords.filter((r) => {
        const row = r as { shipment_id?: number | string | null; has_tech_scan?: boolean; packed_at?: string | null; out_of_stock?: string | null };
        return deriveUnshippedState({
          shipmentId: row.shipment_id,
          hasTechScan: Boolean(row.has_tech_scan),
          packedAt: row.packed_at,
          outOfStock: row.out_of_stock,
        }) === statusFilter;
      })
    : stageRecords;

  return (
    <OrdersQueueTable
      records={records}
      sort={sortOrder}
      selectMode={selectMode}
      selectionScope={DASHBOARD_ORDERS_SELECTION_SCOPE}
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      onClearSearch={clearSearch}
      emptyMessage="No unshipped orders"
      searchEmptyTitle={searchEmptyTitle}
      searchResultLabel={searchResultLabel}
      clearSearchLabel={clearSearchLabel}
      bannerTitle={bannerTitle}
      bannerSubtitle={bannerSubtitle}
      onOpenRecord={(record) => {
        dispatchOpenShippedDetails(record, 'queue');
      }}
      onCloseRecord={() => {
        dispatchCloseShippedDetails();
      }}
    />
  );
}
