'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getOrdersChannelName, getRepairsChannelName, getStationChannelName, getWalkInChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';

const ORDERS_CHANNEL = getOrdersChannelName();
const REPAIRS_CHANNEL = getRepairsChannelName();
const STATION_CHANNEL = getStationChannelName();
const WALKIN_CHANNEL = getWalkInChannelName();

interface UseRealtimeInvalidationOptions {
  dashboard?: boolean;
  repair?: boolean;
  receiving?: boolean;
  walkIn?: boolean;
}

export function useRealtimeInvalidation({
  dashboard = false,
  repair = false,
  receiving = false,
  walkIn = false,
}: UseRealtimeInvalidationOptions = {}) {
  const queryClient = useQueryClient();

  useAblyChannel(
    ORDERS_CHANNEL,
    'order.changed',
    () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped-fba'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] });
    },
    dashboard,
  );

  // Assignment changes can patch one table in-place, but other dashboard
  // caches (including alternate filters/views) still need a refetch.
  useAblyChannel(
    ORDERS_CHANNEL,
    'order.assignments',
    () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped-fba'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] });
    },
    dashboard,
  );

  useAblyChannel(
    ORDERS_CHANNEL,
    'queue.assignments',
    () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped-fba'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] });
    },
    dashboard,
  );

  // Serial added from the tech station publishes order.tested (not order.changed).
  // Invalidate shipped views so the serial list in the details panel stays current.
  useAblyChannel(
    ORDERS_CHANNEL,
    'order.tested',
    () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped-fba'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
      queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] });
    },
    dashboard,
  );

  useAblyChannel(
    REPAIRS_CHANNEL,
    'repair.changed',
    () => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
    },
    repair,
  );

  useAblyChannel(
    STATION_CHANNEL,
    'receiving-log.changed',
    () => {
      queryClient.invalidateQueries({ queryKey: ['receiving'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
      // 'receiving-logs' is intentionally omitted: ReceivingLogs handles it
      // surgically via its own useAblyChannel (insert→insertIntoCache,
      // delete→removeFromCache). Invalidating here races with the refetch
      // and can overwrite the cache with stale data, causing new entries
      // to flash and disappear.
      queryClient.invalidateQueries({ queryKey: ['receiving-lines'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-lines-with-serials'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-line-serials'] });
    },
    receiving,
  );

  useAblyChannel(
    WALKIN_CHANNEL,
    'sale.completed',
    () => {
      queryClient.invalidateQueries({ queryKey: ['walk-in-sales'] });
    },
    walkIn,
  );
}
