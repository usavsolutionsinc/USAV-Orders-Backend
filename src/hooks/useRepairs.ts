'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RSRecord } from '@/lib/neon/repair-service-queries';
import { useAblyChannel } from './useAblyChannel';

const REPAIRS_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_REPAIR_CHANGES || 'repair:changes';

export function useRepairs(search?: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['repairs', search || ''] as const;

  const query = useQuery<RSRecord[]>({
    queryKey,
    queryFn: async () => {
      const url = search
        ? `/api/repair-service?q=${encodeURIComponent(search)}`
        : '/api/repair-service';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch repairs');
      const data = await res.json();
      return data.repairs || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  // Live invalidation via Ably whenever any repair row changes.
  useAblyChannel(REPAIRS_CHANNEL, 'repair.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['repairs'] });
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient]);

  return query;
}
