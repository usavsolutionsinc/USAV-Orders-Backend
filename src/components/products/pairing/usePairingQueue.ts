'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PairingQueueItem, PairingQueueResponse } from './types';

interface UsePairingQueueResult {
  items: PairingQueueItem[];
  total: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches /api/sku-catalog/pairing-queue and keeps it fresh when the user
 * commits a pair-batch (listening on the `sku-pairing-updated` event the
 * Product Hub dispatches after a successful save).
 */
export function usePairingQueue(query: string): UsePairingQueueResult {
  const [items, setItems] = useState<PairingQueueItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestIdRef = useRef(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const id = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const url = new URL('/api/sku-catalog/pairing-queue', window.location.origin);
        if (query.trim()) url.searchParams.set('q', query.trim());
        url.searchParams.set('limit', '200');
        const res = await fetch(url.toString(), { credentials: 'same-origin' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const payload: PairingQueueResponse = await res.json();
        if (cancelled || id !== requestIdRef.current) return;
        setItems(payload.items);
        setTotal(payload.total);
      } catch (err) {
        if (cancelled || id !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'failed');
        setItems([]);
        setTotal(null);
      } finally {
        if (!cancelled && id === requestIdRef.current) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [query, refreshKey]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('sku-pairing-updated', handler);
    return () => window.removeEventListener('sku-pairing-updated', handler);
  }, [refresh]);

  return { items, total, loading, error, refresh };
}
