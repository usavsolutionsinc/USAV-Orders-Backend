'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { awaitingLabelsQuery } from '@/lib/queries/outbound-queries';
import type { OutboundSort } from '@/components/outbound/outbound-sidebar-shared';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

interface LabelsQueueTableProps {
  searchQuery: string;
  sort: OutboundSort;
  onOpenOrder: (order: ShippedOrder) => void;
  onCloseOrder: () => void;
}

export function LabelsQueueTable({
  searchQuery,
  sort,
  onOpenOrder,
  onCloseOrder,
}: LabelsQueueTableProps) {
  const query = useQuery(awaitingLabelsQuery({ searchQuery, sort }));

  const records = useMemo(() => {
    const rows = [...(query.data ?? [])];
    if (sort === 'newest') {
      rows.sort((a, b) => {
        const aTs = Date.parse(String(a.created_at || '')) || 0;
        const bTs = Date.parse(String(b.created_at || '')) || 0;
        return bTs - aTs;
      });
      return rows;
    }
    rows.sort((a, b) => {
      const aDeadline = Date.parse(String(a.deadline_at || '')) || Number.MAX_SAFE_INTEGER;
      const bDeadline = Date.parse(String(b.deadline_at || '')) || Number.MAX_SAFE_INTEGER;
      if (aDeadline !== bDeadline) return aDeadline - bDeadline;
      const aTs = Date.parse(String(a.created_at || '')) || 0;
      const bTs = Date.parse(String(b.created_at || '')) || 0;
      return aTs - bTs;
    });
    return rows;
  }, [query.data, sort]);

  return (
    <OrdersQueueTable
      records={records}
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      onClearSearch={() => undefined}
      emptyMessage="No orders awaiting labels"
      searchEmptyTitle="No matching orders"
      searchResultLabel="orders awaiting labels"
      clearSearchLabel="Show all awaiting labels"
      bannerTitle="Awaiting label"
      bannerSubtitle={`${records.length} order${records.length === 1 ? '' : 's'} need a carrier label`}
      sort={sort}
      onOpenRecord={(record) => onOpenOrder(record)}
      onCloseRecord={() => onCloseOrder()}
    />
  );
}
