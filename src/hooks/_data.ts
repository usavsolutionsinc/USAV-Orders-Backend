import { useState, useEffect, useCallback, useRef } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Generic data fetcher with loading/error state and race condition protection.
 * Integrates with the ID-keyed cache layer (see src/lib/cache.ts).
 *
 * @example
 * const { data, loading, error, refetch } = useFetch(
 *   () => fetchOrderById(orderId),
 *   [orderId]
 * );
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const runRef = useRef(0);

  const run = useCallback(async () => {
    const id = ++runRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (id === runRef.current) setData(result);
    } catch (e) {
      if (id === runRef.current)
        setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (id === runRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, loading, error, refetch: run };
}

interface MutationState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  mutate: (...args: unknown[]) => Promise<T | null>;
  reset: () => void;
}

/**
 * Handles an async mutation (POST/PATCH/DELETE) with loading/error state.
 *
 * @example
 * const { mutate, loading, error } = useMutation((id) => deleteOrder(id));
 * await mutate(orderId);
 */
export function useMutation<T, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
): MutationState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = useCallback(
    async (...args: Args): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fn(...args);
        setData(result);
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  ) as (...args: unknown[]) => Promise<T | null>;

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, mutate, reset };
}
