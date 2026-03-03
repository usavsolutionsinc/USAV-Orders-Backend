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

export function useTechLogs(techId: number) {
  const queryClient = useQueryClient();
  const queryKey = ['tech-logs', techId] as const;

  const query = useQuery<TechRecord[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/tech-logs?techId=${techId}&limit=5000`);
      if (!res.ok) throw new Error('Failed to fetch tech logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
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
