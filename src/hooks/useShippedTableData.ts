'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShippedOrder } from '@/lib/neon/orders-queries';

interface UseShippedTableDataOptions {
  search?: string;
  packedBy?: number;
  testedBy?: number;
  ordersOnly?: boolean;
  missingTrackingOnly?: boolean;
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

async function fetchShippedData(options: UseShippedTableDataOptions): Promise<ShippedOrder[]> {
  const {
    search = '',
    packedBy,
    testedBy,
    ordersOnly = false,
    missingTrackingOnly = false,
    weekRange,
  } = options;

  let url: string;
  if (!ordersOnly) {
    url = search ? `/api/shipped?q=${encodeURIComponent(search)}` : '/api/shipped?limit=5000';
  } else {
    const params = new URLSearchParams();
    if (weekRange) {
      params.set('weekStart', weekRange.startStr);
      params.set('weekEnd', weekRange.endStr);
    }
    if (search.trim()) params.set('q', search.trim());
    if (missingTrackingOnly) params.set('missingTrackingOnly', 'true');
    if (packedBy !== undefined) params.set('packedBy', String(packedBy));
    if (testedBy !== undefined) params.set('testedBy', String(testedBy));
    url = `/api/orders?${params.toString()}`;
  }

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch shipped data');
  const data = await res.json();

  let records: ShippedOrder[] = data.results || data.shipped || [];
  if (ordersOnly) {
    records = (data.orders || []).map((order: any) => ({
      ...order,
      pack_date_time: order.ship_by_date || null,
      packed_by: order.packer_id ?? null,
      tested_by: order.tester_id ?? null,
      serial_number: '',
      condition: order.condition || '',
    }));
  }
  if (missingTrackingOnly) {
    records = records.filter((record) => {
      const tracking = String((record as any).shipping_tracking_number || '').trim();
      return tracking.length === 0;
    });
  }
  if (packedBy !== undefined) {
    records = records.filter((record) => (record as any).packed_by === packedBy);
  }
  if (testedBy !== undefined) {
    records = records.filter((record) => (record as any).tested_by === testedBy);
  }
  return records;
}

export function useShippedTableData(options: UseShippedTableDataOptions = {}) {
  const { search = '', packedBy, testedBy, ordersOnly = false, missingTrackingOnly = false, weekOffset = 0 } = options;
  const queryClient = useQueryClient();

  const queryKey = [
    'shipped-table',
    { search, packedBy, testedBy, ordersOnly, missingTrackingOnly, weekOffset },
  ] as const;

  const query = useQuery<ShippedOrder[]>({
    queryKey,
    queryFn: () => fetchShippedData(options),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    window.addEventListener('dashboard-refresh', handleRefresh);
    return () => {
      window.removeEventListener('usav-refresh-data', handleRefresh);
      window.removeEventListener('dashboard-refresh', handleRefresh);
    };
  }, [queryClient]);

  return query;
}
