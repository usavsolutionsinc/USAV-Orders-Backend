'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAllStationLists } from '@/lib/queries/station-cache-patch';

/**
 * `useStationReconnectSync` — the reconnect half of the station incremental-sync
 * model (station-table-unification-plan §7.4). The hot path is Ably/local cache
 * patches (no full refetch); the ONLY broad invalidate is on reconnect, when a
 * tab may have missed live events while offline. Fires
 * {@link invalidateAllStationLists} (the `tech-logs`/`packer-logs`/`receiving-lines`
 * prefixes) when the browser comes back `online`, so a station table reconciles
 * once instead of polling.
 */
export function useStationReconnectSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onOnline = () => invalidateAllStationLists(queryClient);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [queryClient]);
}
