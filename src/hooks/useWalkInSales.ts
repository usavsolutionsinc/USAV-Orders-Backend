'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from './useAblyChannel';
import { getWalkInChannelName } from '@/lib/realtime/channels';
import type { SquareTransactionRecord } from '@/lib/neon/square-transaction-queries';

const WALKIN_CHANNEL = getWalkInChannelName();

export function useWalkInSales(
  search?: string | null,
  options?: {
    status?: string | null;
    weekStart?: string;
    weekEnd?: string;
  },
) {
  const queryClient = useQueryClient();
  const weekStart = options?.weekStart || '';
  const weekEnd = options?.weekEnd || '';
  const status = options?.status || '';
  const queryKey = ['walk-in-sales', search || '', weekStart, weekEnd, status] as const;

  const query = useQuery<SquareTransactionRecord[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      if (weekStart) params.set('weekStart', weekStart);
      if (weekEnd) params.set('weekEnd', weekEnd);
      const qs = params.toString();
      const url = `/api/walk-in/sales${qs ? `?${qs}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch walk-in sales');
      const data = await res.json();
      return data.rows || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  useAblyChannel(WALKIN_CHANNEL, 'sale.completed', () => {
    queryClient.invalidateQueries({ queryKey: ['walk-in-sales'] });
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['walk-in-sales'] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient]);

  return query;
}
