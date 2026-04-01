'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { getOrdersChannelName, getStationChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';

const ORDERS_CHANNEL = getOrdersChannelName();
const STATION_CHANNEL = getStationChannelName();

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
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (weekRange) {
      params.set('weekStart', weekRange.startStr);
      params.set('weekEnd', weekRange.endStr);
      params.set('limit', '1000');
    } else {
      params.set('limit', '5000');
    }
    if (missingTrackingOnly) params.set('missingTrackingOnly', 'true');
    if (packedBy !== undefined) params.set('packedBy', String(packedBy));
    if (testedBy !== undefined) params.set('testedBy', String(testedBy));
    url = `/api/shipped?${params.toString()}`;
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

  const res = await fetch(url); // bypass browser HTTP cache; Upstash Redis handles server-side caching
  if (!res.ok) throw new Error('Failed to fetch shipped data');
  const data = await res.json();

  let records: ShippedOrder[] = data.results || data.shipped || [];
  if (ordersOnly) {
    records = (data.orders || []).map((order: any) => ({
      ...order,
      packed_at: order.ship_by_date || null,
      packed_by: order.packed_by ?? null,
      tested_by: order.tested_by ?? null,
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
    {
      search,
      packedBy,
      testedBy,
      ordersOnly,
      missingTrackingOnly,
      weekStart: options.weekRange?.startStr ?? '',
      weekEnd: options.weekRange?.endStr ?? '',
    },
  ] as const;

  const query = useQuery<ShippedOrder[]>({
    queryKey,
    queryFn: () => fetchShippedData(options),
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  // Live invalidation: orders table changed (assignment, status, is_shipped)
  useAblyChannel(ORDERS_CHANNEL, 'order.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
  });

  // Assignment broadcasts can change deadline/tester/packer fields that appear
  // in shipped/order views even when no base row mutation fires.
  useAblyChannel(ORDERS_CHANNEL, 'order.assignments', () => {
    queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
  });

  useAblyChannel(ORDERS_CHANNEL, 'queue.assignments', () => {
    queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
  });

  // A serial was added from the tech station (insertTechSerialForTracking publishes
  // order.tested, not order.changed). Without this listener the shipped table cache
  // stays stale and the details panel shows an incomplete serial list.
  useAblyChannel(ORDERS_CHANNEL, 'order.tested', () => {
    queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
  });

  // A packer log was inserted → order transitioned to shipped
  useAblyChannel(STATION_CHANNEL, 'packer-log.changed', () => {
    queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
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
