'use client';

/**
 * OfflineBanner — sticky top banner that appears when the device goes offline.
 *
 * Slides down from the top, stays until the connection comes back. When the
 * device reconnects, the banner morphs to a "Back online" confirmation that
 * auto-dismisses after a short delay.
 *
 * Subscribes to the same external store as `NetworkChip` (navigator.onLine
 * via `subscribe`) so both surfaces stay in sync without duplicate listeners.
 *
 * Drop this near the top of any mobile shell — it positions itself absolutely
 * (z-banner) and shouldn't push layout when hidden.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff, Wifi } from 'lucide-react';

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}
function getSnapshot(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}
function getServerSnapshot(): boolean {
  return true;
}

interface OfflineBannerProps {
  /** Milliseconds to keep the "back online" toast visible. Default 2400. */
  reconnectToastMs?: number;
}

export function OfflineBanner({ reconnectToastMs = 2400 }: OfflineBannerProps) {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Track whether we've ever been offline in this mount — used to gate the
  // reconnect toast so a fresh page load doesn't flash "Back online".
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnect, setShowReconnect] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setShowReconnect(false);
      return;
    }
    if (wasOffline) {
      setShowReconnect(true);
      const t = window.setTimeout(() => setShowReconnect(false), reconnectToastMs);
      return () => window.clearTimeout(t);
    }
  }, [online, wasOffline, reconnectToastMs]);

  const visible = !online || showReconnect;
  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={online ? 'online' : 'offline'}
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -48, opacity: 0 }}
        transition={{ type: 'spring', damping: 24, stiffness: 320, mass: 0.5 }}
        role="status"
        aria-live="polite"
        className={`fixed inset-x-0 top-0 z-banner ${
          online ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold tracking-wide">
          {online ? (
            <>
              <Wifi className="h-4 w-4" aria-hidden="true" />
              <span>Back online</span>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4" aria-hidden="true" />
              <span>Offline — actions will queue and sync when reconnected</span>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
