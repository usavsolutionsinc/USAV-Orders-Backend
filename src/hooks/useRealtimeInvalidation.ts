'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getOrdersChannelName,
  getRepairsChannelName,
  getStationChannelName,
  getWalkInChannelName,
} from '@/lib/realtime/channels';
import { useAblyClient } from '@/contexts/AblyContext';
import { useAblyChannel } from './useAblyChannel';
import { qk } from '@/queries/keys';

const ORDERS_CHANNEL = getOrdersChannelName();
const REPAIRS_CHANNEL = getRepairsChannelName();
const STATION_CHANNEL = getStationChannelName();
const WALKIN_CHANNEL = getWalkInChannelName();

interface UseRealtimeInvalidationOptions {
  dashboard?: boolean;
  repair?: boolean;
  receiving?: boolean;
  walkIn?: boolean;
  /**
   * Register a connection listener that invalidates *all* dashboard caches
   * when the Ably realtime client reconnects after a disconnect (e.g. laptop
   * sleep, network blip). Events published while disconnected are lost, so a
   * broad invalidate is the safe recovery.
   *
   * Set `true` on the top-level dashboard page; channel-scoped consumers
   * (e.g. a mobile receiving list) typically don't need this — their parent
   * dashboard handles it.
   */
  reconnect?: boolean;
}

export function useRealtimeInvalidation({
  dashboard = false,
  repair = false,
  receiving = false,
  walkIn = false,
  reconnect = false,
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
      queryClient.invalidateQueries({ queryKey: qk.repairs.all });
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
      // Mobile pipeline (/m/receiving) — PO-grouped list, PO detail, photos.
      queryClient.invalidateQueries({ queryKey: ['receiving-po-list'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-po-detail'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-photos'] });
      queryClient.invalidateQueries({ queryKey: ['receiving-item-photos'] });
    },
    receiving,
  );

  useAblyChannel(
    WALKIN_CHANNEL,
    'sale.completed',
    () => {
      queryClient.invalidateQueries({ queryKey: qk.walkInSales.all });
    },
    walkIn,
  );

  // ─── Reconnect listener ────────────────────────────────────────────────
  // Events published while the realtime client is disconnected are lost, so
  // when the connection recovers we invalidate broadly. Hooks must run
  // unconditionally — the `reconnect` flag gates the effect body, not the
  // hook call itself.
  const { getClient } = useAblyClient();
  const wasDisconnectedRef = useRef(false);

  useEffect(() => {
    if (!reconnect) return;
    let disposed = false;
    let listener: ((stateChange: { current: string; previous: string }) => void) | null = null;
    let client: { connection: { on: (fn: typeof listener) => void; off: (fn: typeof listener) => void } } | null = null;

    getClient()
      .then((c) => {
        if (disposed || !c) return;
        client = c as typeof client;
        listener = (stateChange) => {
          const { current } = stateChange;
          if (current === 'disconnected' || current === 'suspended') {
            wasDisconnectedRef.current = true;
          }
          if (current === 'connected' && wasDisconnectedRef.current) {
            wasDisconnectedRef.current = false;
            console.log('[ably] Reconnected after disconnect — invalidating dashboard caches');
            queryClient.invalidateQueries({ queryKey: ['dashboard-table'] });
            queryClient.invalidateQueries({ queryKey: ['shipped-table'] });
            queryClient.invalidateQueries({ queryKey: ['shipped-table-fba'] });
            queryClient.invalidateQueries({ queryKey: ['fba-board'] });
            queryClient.invalidateQueries({ queryKey: ['fba-shipments'] });
            queryClient.invalidateQueries({ queryKey: qk.repairs.all });
            queryClient.invalidateQueries({ queryKey: ['receiving'] });
            queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
            queryClient.invalidateQueries({ queryKey: ['receiving-lines-table'] });
            queryClient.invalidateQueries({ queryKey: ['receiving-lines'] });
            queryClient.invalidateQueries({ queryKey: ['receiving-lines-with-serials'] });
            queryClient.invalidateQueries({ queryKey: ['receiving-line-serials'] });
            queryClient.invalidateQueries({ queryKey: qk.walkInSales.all });
            queryClient.invalidateQueries({ queryKey: ['dashboard-operations'] });
          }
        };
        client?.connection.on(listener);
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (client && listener) {
        try {
          client.connection.off(listener);
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnect]);
}
