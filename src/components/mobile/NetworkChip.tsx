'use client';

/**
 * NetworkChip — compact online/offline status pill for mobile shells.
 *
 * Subscribes to `navigator.onLine` plus the `online`/`offline` window events.
 * Optionally accepts a `pendingCount` for an offline action queue (used once
 * the IndexedDB-backed queue lands in B4).
 *
 * Lives in `MobileShellToolbarConfig.trailing`. Designed to be glanceable —
 * green dot = online, amber dot = pending replay, red = offline.
 */

import { useSyncExternalStore } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export interface NetworkChipProps {
  /** Pending action count from the offline queue. */
  pendingCount?: number;
  /** Compact mode hides the label and shrinks the chip to icon-only. */
  compact?: boolean;
  className?: string;
}

// External-store subscription — single source of truth across the app.
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
  // SSR optimistic: assume online so first paint matches the most common case.
  return true;
}

export function NetworkChip({ pendingCount = 0, compact = false, className = '' }: NetworkChipProps) {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hasPending = pendingCount > 0;

  const tone = !online
    ? 'border-red-200 bg-red-50 text-red-700'
    : hasPending
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  const dotTone = !online
    ? 'bg-red-500'
    : hasPending
      ? 'bg-amber-500 animate-pulse'
      : 'bg-emerald-500';

  const label = !online ? 'Offline' : hasPending ? `${pendingCount} pending` : 'Online';
  const Icon = online ? Wifi : WifiOff;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`Network status: ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold tracking-wide ${tone} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} aria-hidden="true" />
      {compact ? (
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <span className="leading-none">{label}</span>
      )}
    </span>
  );
}
