import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheGet, cacheSet, cacheInvalidate, onCacheInvalidate, DEFAULT_TTL_MS } from '@/lib/cache';

interface UseCacheOptions<T> {
  /** Domain name — use a constant from CACHE_DOMAINS */
  domain: string;
  /** Entity ID — the per-domain cache key */
  id: string | number;
  /** Async function to load data when cache is empty or expired */
  fetcher: () => Promise<T>;
  /** TTL in ms. null = permanent entry. Defaults to DEFAULT_TTL_MS (5 min). */
  ttlMs?: number | null;
  /** Skip fetching entirely when false. Useful for conditional loading. */
  enabled?: boolean;
}

interface UseCacheReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Deletes the cache entry and immediately refetches from the source. */
  invalidate: () => void;
  /** Updates the cache value in-place without a network round-trip. */
  updateCache: (value: T) => void;
}

/**
 * Fetches and caches data by domain + ID.
 * Automatically refetches when the cache entry is invalidated via `cacheInvalidate`.
 *
 * @example
 * const { data: order, loading } = useCache({
 *   domain: CACHE_DOMAINS.ORDER,
 *   id: orderId,
 *   fetcher: () => fetchOrderById(orderId),
 *   ttlMs: CACHE_TTL.DEFAULT,
 * });
 */
export function useCache<T>({
  domain,
  id,
  fetcher,
  ttlMs = DEFAULT_TTL_MS,
  enabled = true,
}: UseCacheOptions<T>): UseCacheReturn<T> {
  const [data, setData] = useState<T | null>(() => {
    const cached = cacheGet<T>(domain, id);
    return cached ?? null;
  });
  const [loading, setLoading] = useState<boolean>(data === null && enabled);
  const [error, setError] = useState<Error | null>(null);
  const runCount = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;

    const cached = cacheGet<T>(domain, id);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
      return;
    }

    const run = ++runCount.current;
    setLoading(true);
    setError(null);

    try {
      const result = await fetcher();
      if (run !== runCount.current) return;
      cacheSet(domain, id, result, ttlMs);
      setData(result);
    } catch (e) {
      if (run !== runCount.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (run === runCount.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, id, ttlMs, enabled]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Listen for invalidation events on this domain
  useEffect(() => {
    return onCacheInvalidate(domain, (invalidatedId) => {
      if (invalidatedId === '*' || invalidatedId === id) {
        load();
      }
    });
  }, [domain, id, load]);

  const invalidate = useCallback(() => {
    cacheInvalidate(domain, id);
    load();
  }, [domain, id, load]);

  const updateCache = useCallback(
    (value: T) => {
      cacheSet(domain, id, value, ttlMs);
      setData(value);
    },
    [domain, id, ttlMs],
  );

  return { data, loading, error, invalidate, updateCache };
}
