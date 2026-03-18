import { useState, useCallback } from 'react';

/**
 * Syncs React state to localStorage.
 * Restores from storage on mount; persists on every set call.
 *
 * @param key   localStorage key
 * @param init  Default value if key is absent or parse fails
 * @returns     [value, setValue, removeValue]
 */
export function useLocalStorage<T>(
  key: string,
  init: T,
): [T, (val: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return init;
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : init;
    } catch {
      return init;
    }
  });

  const set = useCallback(
    (val: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof val === 'function' ? (val as (p: T) => T)(prev) : val;
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(key, JSON.stringify(next));
          }
        } catch {
          // Storage quota exceeded — silently ignore
        }
        return next;
      });
    },
    [key],
  );

  const remove = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(key);
    }
    setValue(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, set, remove] as const;
}

/**
 * Syncs React state to sessionStorage.
 * Same API as useLocalStorage but scoped to the browser session.
 */
export function useSessionStorage<T>(
  key: string,
  init: T,
): [T, (val: T | ((prev: T) => T)) => void, () => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return init;
    try {
      const item = sessionStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : init;
    } catch {
      return init;
    }
  });

  const set = useCallback(
    (val: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof val === 'function' ? (val as (p: T) => T)(prev) : val;
        try {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(key, JSON.stringify(next));
          }
        } catch {
          // Storage quota exceeded — silently ignore
        }
        return next;
      });
    },
    [key],
  );

  const remove = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(key);
    }
    setValue(init);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, set, remove] as const;
}
