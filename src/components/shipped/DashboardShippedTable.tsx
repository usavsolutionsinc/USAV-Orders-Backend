'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toPSTDateKey, getCurrentPSTDateKey } from '@/lib/timezone';
import { OrderRecordsTable } from './OrderRecordsTable';
import { fetchDashboardShippedData } from '@/lib/dashboard-table-data';

interface DashboardShippedTableProps {
  packedBy?: number;
  testedBy?: number;
}

function getWeekRangeForOffset(weekOffset: number, anchorDateKey?: string) {
  const baseDateKey = anchorDateKey || getCurrentPSTDateKey();
  const [pstYear, pstMonth, pstDay] = baseDateKey.split('-').map(Number);
  const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
  const currentDay = now.getDay();
  const daysFromMonday = currentDay === 0 ? 6 : currentDay - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday - (weekOffset * 7));
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return {
    startStr: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endStr: `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`,
  };
}

export function DashboardShippedTable({
  packedBy,
  testedBy,
}: DashboardShippedTableProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const search = searchParams.get('search') || '';
  const weekOffset = Math.max(0, Number.parseInt(searchParams.get('shippedWeekOffset') || '0', 10) || 0);
  const weekRange = getWeekRangeForOffset(weekOffset);
  const queryKey = ['dashboard-table', 'shipped', { search, packedBy, testedBy }] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchDashboardShippedData({ searchQuery: search, packedBy, testedBy }),
    staleTime: 60000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
    };

    window.addEventListener('usav-refresh-data' as any, handleRefresh as any);
    window.addEventListener('dashboard-refresh' as any, handleRefresh as any);

    return () => {
      window.removeEventListener('usav-refresh-data' as any, handleRefresh as any);
      window.removeEventListener('dashboard-refresh' as any, handleRefresh as any);
    };
  }, [queryClient]);

  const setWeekOffsetInUrl = (nextOffset: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextOffset <= 0) {
      params.delete('shippedWeekOffset');
    } else {
      params.set('shippedWeekOffset', String(nextOffset));
    }
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  };

  const baseRecords = query.data || [];
  const filteredRecords = search.trim()
    ? baseRecords
    : baseRecords.filter((record) => {
        const dateKey = toPSTDateKey(record.pack_date_time || record.created_at || '');
        return Boolean(dateKey) && dateKey >= weekRange.startStr && dateKey <= weekRange.endStr;
      });

  const clearSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');
    const nextSearch = params.toString();
    const nextPath = pathname || '/dashboard';
    router.replace(nextSearch ? `${nextPath}?${nextSearch}` : nextPath);
  };

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden">
      <OrderRecordsTable
        records={filteredRecords}
        loading={query.isLoading}
        isRefreshing={query.isFetching && !query.isLoading}
        searchValue={search}
        weekRange={weekRange}
        weekOffset={weekOffset}
        showWeekControls
        onPrevWeek={() => setWeekOffsetInUrl(weekOffset + 1)}
        onNextWeek={() => setWeekOffsetInUrl(Math.max(0, weekOffset - 1))}
        onResetWeek={() => setWeekOffsetInUrl(0)}
        onClearSearch={clearSearch}
        emptyMessage="No shipped records for this week"
      />
    </div>
  );
}
