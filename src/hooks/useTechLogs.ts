'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface TechRecord {
  id: number;
  order_db_id?: number | null;
  test_date_time: string;
  shipping_tracking_number: string;
  serial_number: string;
  tested_by: number;
  ship_by_date?: string | null;
  created_at?: string | null;
  order_id: string | null;
  item_number?: string | null;
  product_title: string | null;
  quantity?: string | null;
  condition: string | null;
  sku: string | null;
  account_source?: string | null;
  notes?: string | null;
  out_of_stock?: string | null;
  is_shipped?: boolean;
}

export interface UseTechLogsOptions {
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

export function useTechLogs(techId: number, options: UseTechLogsOptions = {}) {
  const { weekOffset = 0, weekRange } = options;
  const queryClient = useQueryClient();
  const queryKey = [
    'tech-logs',
    techId,
    { weekStart: weekRange?.startStr ?? '', weekEnd: weekRange?.endStr ?? '' },
  ] as const;

  const query = useQuery<TechRecord[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ techId: String(techId), limit: '1000' });
      if (weekRange) {
        params.set('weekStart', weekRange.startStr);
        params.set('weekEnd', weekRange.endStr);
      }
      const res = await fetch(`/api/tech-logs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch tech logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    // Current week stays fresh for 2 min so new scans appear quickly;
    // historical weeks are cached for 30 min (Redis holds them for 24 h).
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tech-logs', techId] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient, techId]);

  return query;
}
