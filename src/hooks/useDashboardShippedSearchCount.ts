'use client';

import { useDeferredValue } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardShippedData } from '@/lib/dashboard-table-data';

export function useDashboardShippedSearchCount(searchQuery: string) {
  const normalizedQuery = searchQuery.trim();
  const deferredQuery = useDeferredValue(normalizedQuery);

  const query = useQuery({
    queryKey: ['dashboard-search', 'shipped-count', deferredQuery],
    queryFn: async () => {
      const rows = await fetchDashboardShippedData({ searchQuery: deferredQuery });
      return rows.length;
    },
    enabled: deferredQuery.length > 0,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    shippedCount: query.data ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
