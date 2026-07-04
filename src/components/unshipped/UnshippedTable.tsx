'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getOrdersChannelName, safeChannelName } from '@/lib/realtime/channels';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { UnshippedShelfBoard } from '@/components/unshipped/UnshippedShelfBoard';
import { OrdersFirstRunEmptyState } from '@/components/dashboard/OrdersFirstRunEmptyState';
import { dispatchOpenShippedDetails } from '@/utils/events';
import { unshippedOrdersQuery } from '@/lib/queries/dashboard-queries';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { deriveFulfillmentState, type FulfillmentState } from '@/lib/unshipped-state';

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
  // Fulfillment queue stages: pending (not tested) and tested (packing now).
  const stageParam = String(searchParams.get('stage') || 'all').toLowerCase();

  // Legacy `?stage=awaiting` → Outbound · Labels (awaiting moved off Unshipped).
  useEffect(() => {
    if (stageParam !== 'awaiting') return;
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    const qs = params.toString();
    router.replace(qs ? `/outbound?${qs}` : '/outbound', { scroll: false });
  }, [stageParam, searchQuery, router]);

  const stageFilter: 'all' | 'pending' | 'tested' =
    stageParam === 'pending' ? 'pending'
      : stageParam === 'tested' ? 'tested'
        : 'all';
  // The Unshipped queue is board-only: a status-lane pipeline (PENDING / TESTED /
  // BLOCKED) that coexists with the right details slider. Per-lane sort lives in
  // the board (persisted per staffer), so there is no page-level sort/layout fork.
  // Click-to-filter from the status legend (`?ustatus`) — exact derived pre-dock
  // state. Composes on top of the coarse `?stage` facet.
  const statusFilter = String(searchParams.get('ustatus') || '').trim().toUpperCase() as FulfillmentState | '';
  // Universal staff filter (P1-WORK-02): `?staff=` narrows to one staff's
  // assigned work. Absent = ALL staff (current behavior preserved).
  const staffParam = Number(searchParams.get('staff'));
  const staffId = Number.isFinite(staffParam) && staffParam > 0 ? staffParam : undefined;
  const query = useQuery({
    ...unshippedOrdersQuery({ searchQuery, packedBy, testedBy, staffId, strictSearchScope }),
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
      case 'pending':
        return allRecords.filter((r) => !Boolean((r as { has_tech_scan?: boolean }).has_tech_scan));
      case 'tested':
        return allRecords.filter((r) => Boolean((r as { has_tech_scan?: boolean }).has_tech_scan));
      default:
        return allRecords;
    }
  })();
  const records = statusFilter
    ? stageRecords.filter((r) => {
        const row = r as { has_tech_scan?: boolean; out_of_stock?: string | null };
        return deriveFulfillmentState({
          hasTechScan: Boolean(row.has_tech_scan),
          outOfStock: row.out_of_stock,
        }) === statusFilter;
      })
    : stageRecords;

  // First-run teaching state: a brand-new org with zero unshipped orders and no
  // active search/filter sees the "connect a sales channel" CTA instead of three
  // empty lanes that read as broken. Any active search/status/staff filter falls
  // through to the board, which owns its own typed "no matches" empty per lane.
  const isFirstRunEmpty =
    !query.isLoading &&
    allRecords.length === 0 &&
    !searchQuery &&
    !statusFilter &&
    staffId === undefined;

  if (isFirstRunEmpty) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-card p-6">
        <OrdersFirstRunEmptyState />
      </div>
    );
  }

  return (
    <UnshippedShelfBoard
      records={records}
      loading={query.isLoading}
      searchValue={searchQuery}
      selectMode={selectMode}
      onOpenRecord={(record) => {
        dispatchOpenShippedDetails(record, 'queue');
      }}
      onClearSearch={clearSearch}
      searchEmptyTitle={searchEmptyTitle}
      searchResultLabel={searchResultLabel}
      clearSearchLabel={clearSearchLabel}
    />
  );
}
