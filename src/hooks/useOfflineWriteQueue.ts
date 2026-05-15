'use client';

import { useEffect, useState } from 'react';
import {
  QUEUE_EVENT,
  getQueueDepth,
  installOfflineQueueDrainer,
} from '@/lib/offline/write-queue';

/**
 * Subscribe to the offline write queue's depth. Separate from the legacy
 * `useOfflineQueue` (which queues scans for the tracking lookup flow) —
 * this one tracks raw mutating HTTP requests that the new bin editor uses.
 */
export function useOfflineWriteQueue(): { depth: number } {
  const [depth, setDepth] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    installOfflineQueueDrainer();
    let cancelled = false;
    const refresh = async () => {
      const d = await getQueueDepth();
      if (!cancelled) setDepth(d);
    };
    refresh();
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  return { depth };
}
