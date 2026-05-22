'use client';

import { useEffect, useRef, useState } from 'react';

interface PairingCount {
  total: number;
  highConfidence: number;
}

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Reads /api/sku-catalog/pairing-queue/count and refreshes on:
 *   - interval (60s)
 *   - `sku-pairing-updated` window event (fired after any pair-batch commit)
 *   - tab focus
 *
 * Cheap to keep mounted everywhere — the route is a single COUNT(*) over
 * sku_pairing_suggestions and stays under 5ms in practice.
 */
export function usePairingQueueCount(): PairingCount & { loading: boolean } {
  const [state, setState] = useState<PairingCount>({ total: 0, highConfidence: 0 });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/sku-catalog/pairing-queue/count', {
          credentials: 'same-origin',
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled || !mountedRef.current) return;
        setState({
          total: Number(body?.total ?? 0),
          highConfidence: Number(body?.highConfidence ?? 0),
        });
      } catch {
        // Network noise — keep the last good value.
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    };

    load();
    const interval = window.setInterval(load, REFRESH_INTERVAL_MS);
    const onUpdated = () => load();
    const onFocus = () => load();
    window.addEventListener('sku-pairing-updated', onUpdated);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener('sku-pairing-updated', onUpdated);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { ...state, loading };
}
