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

export function usePackerLogs(packerId: number) {
  const queryClient = useQueryClient();
  const queryKey = ['packer-logs', packerId] as const;

  const query = useQuery<PackerRecord[]>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/packerlogs?packerId=${packerId}&limit=5000`);
      if (!res.ok) throw new Error('Failed to fetch packer logs');
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
      queryClient.invalidateQueries({ queryKey: ['packer-logs', packerId] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient, packerId]);

  return query;
}
