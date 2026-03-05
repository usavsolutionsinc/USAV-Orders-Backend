'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface UseRealtimeInvalidationOptions {
  dashboard?: boolean;
  repair?: boolean;
}

export function useRealtimeInvalidation({
  dashboard = false,
  repair = false,
}: UseRealtimeInvalidationOptions = {}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!dashboard && !repair) return;

    let disposed = false;
    let realtimeClient: any = null;
    let ordersChannel: any = null;
    let repairsChannel: any = null;

    const authPath = process.env.NEXT_PUBLIC_ABLY_AUTH_PATH || '/api/realtime/token';
    const ordersChannelName = process.env.NEXT_PUBLIC_ABLY_CHANNEL_ORDERS_CHANGES || 'orders:changes';
    const repairsChannelName = process.env.NEXT_PUBLIC_ABLY_CHANNEL_REPAIR_CHANGES || 'repair:changes';

    const invalidateDashboardQueries = () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'unshipped'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
    };

    const invalidateRepairQueries = () => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
    };

    import('ably').then((Ably) => {
      if (disposed) return;

      realtimeClient = new Ably.Realtime({
        authUrl: authPath,
      });

      if (dashboard) {
        ordersChannel = realtimeClient.channels.get(ordersChannelName);
        ordersChannel.subscribe('order.changed', () => {
          invalidateDashboardQueries();
        });
      }

      if (repair) {
        repairsChannel = realtimeClient.channels.get(repairsChannelName);
        repairsChannel.subscribe('repair.changed', () => {
          invalidateRepairQueries();
        });
      }
    }).catch((error) => {
      console.error('[realtime] Failed to initialize Ably client:', error);
    });

    return () => {
      disposed = true;

      try {
        if (ordersChannel) {
          ordersChannel.unsubscribe('order.changed');
        }
        if (repairsChannel) {
          repairsChannel.unsubscribe('repair.changed');
        }
        if (realtimeClient) {
          realtimeClient.close();
        }
      } catch (error) {
        console.error('[realtime] Cleanup failed:', error);
      }
    };
  }, [dashboard, queryClient, repair]);
}
