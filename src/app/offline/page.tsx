'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Offline fallback served by the PWA service worker when a navigation
 * request fails and there's no cached version of the route.
 *
 * Auto-retries the original URL once `navigator.onLine` flips back to true.
 */
export default function OfflinePage() {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    // Reconnected — try to drop back to whatever route the user came from.
    setRetrying(true);
    const timer = setTimeout(() => router.back(), 400);
    return () => clearTimeout(timer);
  }, [online, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <div className="max-w-sm space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
          <span aria-hidden className="text-3xl">📶</span>
        </div>
        <h1 className="text-xl font-black text-slate-900">No signal</h1>
        <p className="text-sm font-semibold leading-snug text-slate-600">
          {retrying
            ? 'Reconnecting…'
            : online
            ? 'Looks like you are back online. Loading…'
            : 'The page you tapped isn’t cached yet. Stay in this view and we’ll retry the moment you reconnect.'}
        </p>
        <div className="flex justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 active:bg-slate-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') window.location.reload();
            }}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white active:bg-slate-800"
          >
            Retry
          </button>
        </div>
        <p className="pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {online ? 'online' : 'offline'}
        </p>
      </div>
    </div>
  );
}
