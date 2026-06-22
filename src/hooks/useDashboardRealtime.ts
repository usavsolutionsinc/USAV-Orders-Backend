'use client';

/**
 * Wires up the dashboard's realtime side effects in one place: order/dashboard
 * query invalidation (with reconnect), FBA-shipment invalidation, and the admin
 * realtime toast stream. Extracted from the dashboard page; behaviour is
 * unchanged.
 */

import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useFbaRealtimeInvalidation } from '@/hooks/useFbaRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';

export function useDashboardRealtime(): void {
  useRealtimeInvalidation({ dashboard: true, reconnect: true });
  useFbaRealtimeInvalidation();
  useRealtimeToasts('admin');
}
