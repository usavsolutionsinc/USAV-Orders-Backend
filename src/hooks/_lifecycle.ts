import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Runs a callback once on component mount.
 */
export function useMount(fn: () => void): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fn(); }, []);
}

/**
 * Runs a callback on component unmount.
 */
export function useUnmount(fn: () => void): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => fnRef.current(), []);
}

/**
 * Returns the previous value of a reactive variable.
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/**
 * Debounces a value — returns the value only after `delay` ms of no changes.
 * @example const debouncedSearch = useDebounce(searchTerm, 300);
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Throttles a callback to at most once per `limit` ms.
 */
export function useThrottle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit = 300,
): T {
  const lastRan = useRef(Date.now());
  return useCallback(
    (...args: Parameters<T>) => {
      if (Date.now() - lastRan.current >= limit) {
        lastRan.current = Date.now();
        return fn(...args);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, limit],
  ) as T;
}

/**
 * Returns whether the component is currently mounted.
 * Useful for guarding async state updates after unmount.
 */
export function useIsMounted(): () => boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}

/**
 * Tracks how many times the component has rendered (excludes mount).
 */
export function useRenderCount(): number {
  const count = useRef(0);
  count.current += 1;
  return count.current;
}

/**
 * Like useEffect but skips the initial mount — only fires on updates.
 */
export function useUpdateEffect(fn: () => void | (() => void), deps: React.DependencyList): void {
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    return fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
