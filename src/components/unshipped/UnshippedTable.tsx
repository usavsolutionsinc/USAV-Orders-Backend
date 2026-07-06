'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getOrdersChannelName, safeChannelName } from '@/lib/realtime/channels';
import type { DashboardSearchSectionProps } from '@/components/dashboard/DashboardSearchSectionProps';
import { UnshippedShelfBoard } from '@/components/unshipped/UnshippedShelfBoard';
import { OrdersFirstRunEmptyState } from '@/components/dashboard/OrdersFirstRunEmptyState';
import { dispatchOpenShippedDetails } from '@/utils/events';
import { unshippedOrdersQuery, unshippedQueueCountsQuery } from '@/lib/queries/dashboard-queries';
import { Button } from '@/design-system/primitives';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';
import { deriveFulfillmentState, type FulfillmentState } from '@/lib/unshipped-state';
import { patchUnshippedOrderCache, invalidateUnshippedCounts } from '@/lib/queries/dashboard-cache-patch';

export interface UnshippedTableProps extends DashboardSearchSectionProps {
  packedBy?: number;
  testedBy?: number;
  /** Pencil multi-select: rows render checkboxes; the page owns the action bar. */
  selectMode?: boolean;
  /** Flip select-mode — drives the board's in-toolbar Select toggle. */
  onToggleSelectMode?: () => void;
}

/** Map an assignment/order-changed event payload to the flat row patch it implies
 *  (only the fields the event carries). Applied to the cache via
 *  {@link patchUnshippedOrderCache}. */
function assignmentPatchFromEvent(detail: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
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
    patch.tester_id = testerId;
    patch.tester_name = testerName ?? null;
    patch.tested_by_name = testerName ?? null;
  }
  if (packerId !== undefined) {
    patch.packer_id = packerId;
    patch.packer_name = packerName ?? null;
    patch.packed_by_name = packerName ?? null;
  }
  if (deadlineAt !== undefined) patch.deadline_at = deadlineAt;
  if (outOfStock !== undefined) patch.out_of_stock = outOfStock;
  if (notes !== undefined) patch.notes = notes;
  if (itemNumber !== undefined) patch.item_number = itemNumber;
  if (condition !== undefined) patch.condition = condition;
  if (detail?.shippingTrackingNumber !== undefined) patch.shipping_tracking_number = detail.shippingTrackingNumber;

  return patch;
}

export function UnshippedTable({
  packedBy,
  testedBy,
  strictSearchScope = false,
  searchEmptyTitle = 'No orders found',
  searchResultLabel = 'unshipped orders',
  clearSearchLabel = 'Show All Unshipped Orders',
  selectMode = false,
  onToggleSelectMode,
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

  // Phase 2 pagination — a growing row ceiling. "Load more" bumps it; any filter
  // change resets it. A search stays unbounded (results are already the matches).
  const [rowLimit, setRowLimit] = useState(200);
  useEffect(() => { setRowLimit(200); }, [stageFilter, staffId, searchQuery, statusFilter]);

  const query = useQuery({
    ...unshippedOrdersQuery({
      searchQuery,
      packedBy,
      testedBy,
      staffId,
      strictSearchScope,
      // Coarse stage facet now filtered SERVER-side (Phase 1). Absent = all.
      stage: stageFilter === 'all' ? undefined : stageFilter,
      // Bounded page (Phase 2); search stays unbounded.
      limit: searchQuery ? undefined : rowLimit,
    }),
    // Keep rows visible while search/stage refetch, but never bleed the previous
    // staff scope into a new one — that made ?staff= look like it wasn't filtering.
    placeholderData: (previousData, previousQuery) => {
      const prev = previousQuery?.queryKey?.[2] as { staffId?: number } | undefined;
      if (prev?.staffId !== staffId) return undefined;
      return previousData;
    },
  });

  // Stage-aware total from the counts endpoint (dedup-independent) drives the
  // "Load more" affordance without downloading extra rows. Dedupes with the sidebar.
  const { data: queueCounts } = useQuery({
    ...unshippedQueueCountsQuery({ staffId }),
    enabled: !searchQuery,
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

      patchUnshippedOrderCache(queryClient, orderId, assignmentPatchFromEvent(detail));
      // out_of_stock/deadline can change the derived lane → keep the legend fresh.
      invalidateUnshippedCounts(queryClient);
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

      // A tech verdict flips has_tech_scan (pending → tested lane). Patch in place
      // (never clobber an existing tested_by with a null) + refresh the counts.
      const patch: Record<string, unknown> = { has_tech_scan: true };
      if (normalizedTestedById != null) patch.tested_by = normalizedTestedById;
      patchUnshippedOrderCache(queryClient, orderId, patch);
      invalidateUnshippedCounts(queryClient);
    },
    !!ordersChannelName,
  );

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
      invalidateUnshippedCounts(queryClient);
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
      const patch = assignmentPatchFromEvent(detail);
      for (const oid of idSet) patchUnshippedOrderCache(queryClient, oid, patch);
      invalidateUnshippedCounts(queryClient);
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
  // `?stage` (pending/tested) is filtered SERVER-side now (Phase 1), so the query
  // data already reflects it. `?ustatus` stays a client filter — exact derived
  // FulfillmentState (PENDING/TESTED/BLOCKED), Decision 8.
  const records = statusFilter
    ? allRecords.filter((r) => {
        const row = r as { has_tech_scan?: boolean; out_of_stock?: string | null };
        return deriveFulfillmentState({
          hasTechScan: Boolean(row.has_tech_scan),
          outOfStock: row.out_of_stock,
        }) === statusFilter;
      })
    : allRecords;

  // First-run teaching state: a brand-new org with zero unshipped orders and no
  // active search/filter sees the "connect a sales channel" CTA instead of three
  // empty lanes that read as broken. Any active search/status/staff filter falls
  // through to the board, which owns its own typed "no matches" empty per lane.
  const isFirstRunEmpty =
    !query.isLoading &&
    allRecords.length === 0 &&
    !searchQuery &&
    !statusFilter &&
    stageFilter === 'all' &&
    staffId === undefined;

  if (isFirstRunEmpty) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-card p-6">
        <OrdersFirstRunEmptyState />
      </div>
    );
  }

  // Phase 2 "Load more": the stage-aware total (server, dedup-independent) exceeds
  // the loaded ceiling ⇒ more rows exist. Bumping the ceiling refetches the wider
  // page. Hidden during search (results are already the full match set).
  const stageTotal =
    stageFilter === 'pending' ? (queueCounts?.byStage.pending ?? 0)
      : stageFilter === 'tested' ? (queueCounts?.byStage.tested ?? 0)
        : (queueCounts?.total ?? 0);
  const showLoadMore = !searchQuery && stageTotal > rowLimit;
  const footer = showLoadMore ? (
    <div className="flex flex-col items-center gap-1 py-4">
      <Button type="button" variant="secondary" onClick={() => setRowLimit((n) => n + 200)}>
        Load more
      </Button>
      <p className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
        Showing {Math.min(rowLimit, stageTotal)} of {stageTotal}
      </p>
    </div>
  ) : null;

  return (
    <UnshippedShelfBoard
      records={records}
      loading={query.isLoading}
      searchValue={searchQuery}
      selectMode={selectMode}
      onToggleSelectMode={onToggleSelectMode}
      onOpenRecord={(record) => {
        dispatchOpenShippedDetails(record, 'queue');
      }}
      onClearSearch={clearSearch}
      searchEmptyTitle={searchEmptyTitle}
      searchResultLabel={searchResultLabel}
      clearSearchLabel={clearSearchLabel}
      footer={footer}
    />
  );
}
