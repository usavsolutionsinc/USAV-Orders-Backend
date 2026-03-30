'use client';

import { useQueryClient } from '@tanstack/react-query';
import { getOrdersChannelName, getRepairsChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';

const ORDERS_CHANNEL = getOrdersChannelName();
const REPAIRS_CHANNEL = getRepairsChannelName();

interface UseRealtimeInvalidationOptions {
  dashboard?: boolean;
  repair?: boolean;
}

export function useRealtimeInvalidation({
  dashboard = false,
  repair = false,
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
}
