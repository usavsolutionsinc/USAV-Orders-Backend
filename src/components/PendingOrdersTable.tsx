'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderRecordsTable } from '@/components/shipped/OrderRecordsTable';
import { fetchPendingOrdersData } from '@/lib/dashboard-table-data';

export interface PendingOrdersTableProps {
  packedBy?: number;
  testedBy?: number;
}

export default function PendingOrdersTable({
  packedBy,
  testedBy,
}: PendingOrdersTableProps = {}) {
  const [searchQuery, setSearchQuery] = useState('');
  const queryClient = useQueryClient();
  const queryKey = ['dashboard-table', 'pending', { searchQuery, packedBy, testedBy }] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchPendingOrdersData({ searchQuery, packedBy, testedBy }),
    staleTime: 60000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
    };
    const handleDashboardSearch = (e: any) => {
      setSearchQuery(String(e?.detail?.query || '').trim());
    };

    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);
    window.addEventListener('dashboard-search' as any, handleDashboardSearch as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
      window.removeEventListener('dashboard-search' as any, handleDashboardSearch as any);
    };
  }, [queryClient]);

  const clearSearch = () => {
    setSearchQuery('');
    window.dispatchEvent(new CustomEvent('dashboard-search', { detail: { query: '' } }));
  };

  return (
    <OrderRecordsTable
      records={query.data || []}
      loading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      searchValue={searchQuery}
      ordersOnly
      onClearSearch={clearSearch}
      emptyMessage="No pending order records found"
    />
  );
}
