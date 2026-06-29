'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { OrdersFirstRunEmptyState } from '@/components/dashboard/OrdersFirstRunEmptyState';
import { stagedOrdersQuery } from '@/lib/queries/outbound-queries';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

const DOCK_STAGED_BACKFILL_KEY = 'outbound-dock-staged-mike-v1';

interface StagedQueueTableProps {
  searchQuery: string;
  onOpenOrder: (order: ShippedOrder) => void;
  onCloseOrder: () => void;
}

export function StagedQueueTable({
  searchQuery,
  onOpenOrder,
  onCloseOrder,
}: StagedQueueTableProps) {
  const queryClient = useQueryClient();
  const query = useQuery(stagedOrdersQuery({ searchQuery }));
  const records = useMemo(() => query.data ?? [], [query.data]);
  const backfillStarted = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DOCK_STAGED_BACKFILL_KEY)) return;
    if (backfillStarted.current) return;
    backfillStarted.current = true;

    void fetch('/api/outbound/mark-staged', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffName: 'Mike' }),
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ ok?: boolean; marked?: number }>;
      })
      .then((data) => {
        if (!data?.ok) return;
        localStorage.setItem(DOCK_STAGED_BACKFILL_KEY, String(Date.now()));
        if ((data.marked ?? 0) > 0) {
          void queryClient.invalidateQueries({ queryKey: ['outbound', 'staged'] });
        }
      })
      .catch(() => undefined);
  }, [queryClient]);

  const countLabel = `${records.length} package${records.length === 1 ? '' : 's'} ready to scan out`;

  return (
    <OrdersQueueTable
      records={records}
      queueMode="staged"
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      onClearSearch={() => undefined}
      emptyMessage="No packages staged at the dock"
      firstRunEmpty={
        <OrdersFirstRunEmptyState
          title="Nothing staged to ship"
          description="Packages staged at the dock appear here. Connect a sales channel so orders flow into fulfillment."
        />
      }
      searchEmptyTitle="No matching staged packages"
      searchResultLabel="staged packages"
      clearSearchLabel="Show all staged"
      bannerTitle="Staging"
      bannerSubtitle={countLabel}
      bannerCompact
      sort="priority"
      onOpenRecord={(record) => onOpenOrder(record)}
      onCloseRecord={() => onCloseOrder()}
    />
  );
}
