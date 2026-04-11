'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAblyClient } from '@/contexts/AblyContext';

/**
 * When the Ably Realtime connection recovers after a disconnect (e.g. laptop
 * sleep, network blip), any events published while disconnected are lost.
 * This hook detects the reconnect and invalidates all dashboard-related
 * query caches so React Query refetches fresh data.
 */
export function useAblyReconnectInvalidation() {
  const queryClient = useQueryClient();
  const { getClient } = useAblyClient();
  const wasDisconnectedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let listener: ((stateChange: any) => void) | null = null;
    let client: any = null;

    getClient().then((c) => {
      if (disposed || !c) return;
      client = c;

      listener = (stateChange: { current: string; previous: string }) => {
        const { current, previous } = stateChange;

        // Track disconnected state
        if (current === 'disconnected' || current === 'suspended') {
          wasDisconnectedRef.current = true;
        }

        // On reconnect after being disconnected, invalidate everything
        if (current === 'connected' && wasDisconnectedRef.current) {
          wasDisconnectedRef.current = false;
          console.log('[ably] Reconnected after disconnect — invalidating dashboard caches');
          queryClient.invalidateQueries({ queryKey: ['dashboard-table'] });
          queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
          queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] });
          queryClient.invalidateQueries({ queryKey: ['fba-board'] });
          queryClient.invalidateQueries({ queryKey: ['fba-shipments'] });
          queryClient.invalidateQueries({ queryKey: ['repairs'] });
          queryClient.invalidateQueries({ queryKey: ['receiving'] });
          queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
          queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
          queryClient.invalidateQueries({ queryKey: ['receiving-lines'] });
          queryClient.invalidateQueries({ queryKey: ['receiving-lines-with-serials'] });
          queryClient.invalidateQueries({ queryKey: ['receiving-line-serials'] });
          queryClient.invalidateQueries({ queryKey: ['walk-in-sales'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard-operations'] });
        }
      };

      client.connection.on(listener);
    }).catch(() => {});

    return () => {
      disposed = true;
      if (client && listener) {
        try { client.connection.off(listener); } catch {}
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
