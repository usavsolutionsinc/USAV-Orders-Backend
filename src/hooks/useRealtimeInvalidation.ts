'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from './useAblyChannel';

const ORDERS_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES || 'orders:changes';
const REPAIRS_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_REPAIR_CHANGES || 'repair:changes';

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

  useAblyChannel(
    REPAIRS_CHANNEL,
    'repair.changed',
    () => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
    },
    repair,
  );
}
