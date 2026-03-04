'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface PackerRecord {
  id: number;
  pack_date_time: string;
  shipping_tracking_number: string;
  packed_by: number;
  order_id: string | null;
  product_title: string | null;
  quantity?: string | null;
  condition: string | null;
  sku: string | null;
  packer_photos_url: any;
}

export interface UsePackerLogsOptions {
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

export function usePackerLogs(packerId: number, options: UsePackerLogsOptions = {}) {
  const { weekOffset = 0, weekRange } = options;
  const queryClient = useQueryClient();
  const queryKey = [
    'packer-logs',
    packerId,
    { weekStart: weekRange?.startStr ?? '', weekEnd: weekRange?.endStr ?? '' },
  ] as const;

  const query = useQuery<PackerRecord[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ packerId: String(packerId), limit: '1000' });
      if (weekRange) {
        params.set('weekStart', weekRange.startStr);
        params.set('weekEnd', weekRange.endStr);
      }
      const res = await fetch(`/api/packerlogs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch packer logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['packer-logs', packerId] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient, packerId]);

  return query;
}
