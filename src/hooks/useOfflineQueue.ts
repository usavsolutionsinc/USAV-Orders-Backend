'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  enqueue,
  drainQueue,
  queueCount,
  type QueuedScan,
} from '@/lib/offlineQueue';
import { toast } from 'sonner';

interface UseOfflineQueueReturn {
  /** Number of items currently in the queue. */
  pendingCount: number;
  /** Queue a scan for later retry when offline. */
  queueScan: (scan: Omit<QueuedScan, 'id' | 'queuedAt' | 'retries'>) => Promise<void>;
  /** Manually trigger a drain attempt. */
  syncNow: () => Promise<void>;
}

export function useOfflineQueue(): UseOfflineQueueReturn {
  const [pendingCount, setPendingCount] = useState(0);
  const draining = useRef(false);

  const refreshCount = useCallback(async () => {
    const n = await queueCount();
    setPendingCount(n);
  }, []);

  const syncNow = useCallback(async () => {
    if (draining.current || !navigator.onLine) return;
    draining.current = true;
    try {
      const { synced, failed } = await drainQueue();
      await refreshCount();
      if (synced > 0) {
        toast.success(`${synced} offline scan${synced > 1 ? 's' : ''} synced`);
      }
      if (failed > 0) {
        toast.error(`${failed} scan${failed > 1 ? 's' : ''} failed to sync`);
      }
    } finally {
      draining.current = false;
    }
  }, [refreshCount]);

  const queueScan = useCallback(
    async (scan: Omit<QueuedScan, 'id' | 'queuedAt' | 'retries'>) => {
      await enqueue(scan);
      await refreshCount();
      toast.warning('Saved offline — will sync when reconnected', { duration: 3000 });
    },
    [refreshCount],
  );

  // Drain on reconnect
  useEffect(() => {
    const onOnline = () => syncNow();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncNow]);

  // Initial count + drain on mount if online
  useEffect(() => {
    refreshCount();
    if (navigator.onLine) syncNow();
  }, [refreshCount, syncNow]);

  return { pendingCount, queueScan, syncNow };
}
