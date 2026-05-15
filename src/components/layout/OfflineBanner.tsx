'use client';

import { useEffect, useState } from 'react';
import { useOfflineWriteQueue } from '@/hooks/useOfflineWriteQueue';

/**
 * Slim global banner that appears when the browser reports offline. Hidden
 * otherwise. Mount once near the app root.
 *
 * Doesn't try to be smart — `navigator.onLine` is the source of truth.
 * (Captive portals lie sometimes, but the runtime caching + idempotent retries
 * we already have handle that case gracefully.)
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  const [reconnected, setReconnected] = useState(false);
  const { depth } = useOfflineWriteQueue();

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const update = () => {
      const isOnline = navigator.onLine;
      setOnline((prev) => {
        if (prev === false && isOnline) {
          setReconnected(true);
          setTimeout(() => setReconnected(false), 1600);
        }
        return isOnline;
      });
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (online && !reconnected && depth === 0) return null;

  const tone = !online
    ? 'bg-rose-600 text-white'
    : depth > 0
    ? 'bg-amber-600 text-white'
    : 'bg-emerald-600 text-white';

  const message = !online
    ? depth > 0
      ? `Offline — ${depth} change${depth === 1 ? '' : 's'} queued`
      : 'Offline — edits queue until you reconnect'
    : depth > 0
    ? `Syncing ${depth} queued change${depth === 1 ? '' : 's'}…`
    : '✓ Back online';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 top-0 z-[300] px-3 py-1.5 text-center text-[11px] font-black uppercase tracking-widest ${tone}`}
    >
      {message}
    </div>
  );
}
