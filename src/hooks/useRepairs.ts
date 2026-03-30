'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RSRecord, type RepairTab } from '@/lib/neon/repair-service-queries';
import { useAblyChannel } from './useAblyChannel';
import { getDbTableChannelName, getRepairsChannelName } from '@/lib/realtime/channels';

const REPAIRS_CHANNEL = getRepairsChannelName();
const REPAIR_DB_CHANNEL = getDbTableChannelName('public', 'repair_service');

export function useRepairsTable(search?: string | null, tab: RepairTab = 'active') {
  const queryClient = useQueryClient();
  const queryKey = ['repairs', search || '', tab] as const;

  const query = useQuery<RSRecord[]>({
    queryKey,
    queryFn: async () => {
      const url = search
        ? `/api/repair-service?q=${encodeURIComponent(search)}&tab=${encodeURIComponent(tab)}`
        : `/api/repair-service?tab=${encodeURIComponent(tab)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch repairs');
      const data = await res.json();
      return data.rows || data.repairs || [];
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

  useAblyChannel(REPAIR_DB_CHANNEL, 'db.row.changed', () => {
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
