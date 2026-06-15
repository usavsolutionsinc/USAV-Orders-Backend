'use client';

import { queryOptions } from '@tanstack/react-query';
import {
  fetchAwaitingLabelsData,
  fetchStagedOrdersData,
  fetchOutboundOrderRowById,
} from '@/lib/outbound/outbound-table-data';

export type OutboundLabelsSort = 'priority' | 'newest';

export interface OutboundLabelsQueryParams {
  searchQuery?: string;
  sort?: OutboundLabelsSort;
}

export interface OutboundStagedQueryParams {
  searchQuery?: string;
}

export function awaitingLabelsQuery({
  searchQuery = '',
  sort = 'priority',
}: OutboundLabelsQueryParams = {}) {
  return queryOptions({
    queryKey: ['outbound', 'labels', { searchQuery, sort }],
    queryFn: () => fetchAwaitingLabelsData({ searchQuery }),
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
  });
}

export function stagedOrdersQuery({ searchQuery = '' }: OutboundStagedQueryParams = {}) {
  return queryOptions({
    queryKey: ['outbound', 'staged', { searchQuery }],
    queryFn: () => fetchStagedOrdersData({ searchQuery }),
    staleTime: 30_000,
    gcTime: 10 * 60 * 1000,
  });
}

export function outboundOrderByIdQuery(orderId: number) {
  return queryOptions({
    queryKey: ['outbound', 'order', orderId],
    queryFn: () => fetchOutboundOrderRowById(orderId),
    staleTime: 30_000,
    enabled: Number.isFinite(orderId) && orderId > 0,
  });
}
