'use client';

import { useDeferredValue } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAwaitingLabelsData } from '@/lib/outbound/outbound-table-data';

export function useOutboundLabelsSearchCount(searchQuery: string) {
  const normalizedQuery = searchQuery.trim();
  const deferredQuery = useDeferredValue(normalizedQuery);

  const query = useQuery({
    queryKey: ['outbound-search', 'labels-count', deferredQuery],
    queryFn: async () => {
      const rows = await fetchAwaitingLabelsData({ searchQuery: deferredQuery });
      return rows.length;
    },
    enabled: deferredQuery.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    labelsCount: query.data ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
