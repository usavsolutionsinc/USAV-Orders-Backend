# 02 — Hooks Consolidation

---

## Goals

- Merge all scattered custom hooks into a single `src/hooks/index.ts` barrel file
- Eliminate duplicate hook logic across the codebase
- Standardise hook naming conventions (`use[Domain][Action]`)
- Document every exported hook with JSDoc
- Make hooks tree-shakeable via named exports

---

## 1. Audit: Find All Hooks

```bash
# Find every custom hook file
find src -name "use*.ts" -o -name "use*.tsx" | sort

# Find inline hooks defined inside component files
grep -rn "^const use[A-Z]" src/ --include="*.tsx"
```

Catalogue results into categories:

| Category | Examples |
|----------|---------|
| Data fetching | `useFetchUser`, `useGetPosts`, `useLoadDashboard` |
| Form state | `useForm`, `useField`, `useFormValidation` |
| UI / UX | `useModal`, `useToast`, `useScroll`, `useBreakpoint` |
| Auth | `useAuth`, `useSession`, `usePermissions` |
| Cache | `useCache`, `useQueryCache`, `useCachedFetch` |
| Storage | `useLocalStorage`, `useSessionStorage` |
| Lifecycle | `useMount`, `useUnmount`, `usePrevious`, `useDebounce` |

---

## 2. Target File Structure

```
src/
  hooks/
    index.ts          ← single barrel export (the only import needed)
    _data.ts          ← data fetching hooks
    _form.ts          ← form + validation hooks
    _ui.ts            ← UI/UX hooks
    _auth.ts          ← auth/session hooks
    _cache.ts         ← caching hooks
    _storage.ts       ← localStorage / sessionStorage hooks
    _lifecycle.ts     ← mount, debounce, throttle, previous
```

`index.ts` re-exports everything:

```ts
export * from './_data';
export * from './_form';
export * from './_ui';
export * from './_auth';
export * from './_cache';
export * from './_storage';
export * from './_lifecycle';
```

**Import pattern everywhere in the app:**

```ts
// ✅ Always import from the barrel
import { useAuth, useLocalStorage, useDebounce } from '@/hooks';

// ❌ Never import from the internal files directly
import { useAuth } from '@/hooks/_auth';
```

---

## 3. Core Hook Implementations

### `_lifecycle.ts`

```ts
import { useEffect, useRef, useState, useCallback } from 'react';

/** Runs callback once on mount */
export function useMount(fn: () => void) {
  useEffect(() => { fn(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Runs callback on unmount */
export function useUnmount(fn: () => void) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => () => fnRef.current(), []);
}

/** Returns previous value of a variable */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}

/** Debounces a value by `delay` ms */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Throttles a callback */
export function useThrottle<T extends (...args: unknown[]) => unknown>(fn: T, limit = 300): T {
  const lastRan = useRef(Date.now());
  return useCallback((...args: Parameters<T>) => {
    if (Date.now() - lastRan.current >= limit) {
      lastRan.current = Date.now();
      return fn(...args);
    }
  }, [fn, limit]) as T;
}
```

---

### `_storage.ts`

```ts
import { useState, useEffect, useCallback } from 'react';

/**
 * Syncs state to localStorage.
 * @param key   localStorage key
 * @param init  default value if key absent
 */
export function useLocalStorage<T>(key: string, init: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : init;
    } catch {
      return init;
    }
  });

  const set = useCallback((val: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof val === 'function' ? (val as (p: T) => T)(prev) : val;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, [key]);

  const remove = useCallback(() => {
    localStorage.removeItem(key);
    setValue(init);
  }, [key, init]);

  return [value, set, remove] as const;
}
```

---

### `_ui.ts`

```ts
import { useState, useEffect, useCallback, useRef } from 'react';

/** Tracks window scroll position */
export function useScrollPosition() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handler = () => setPos({ x: window.scrollX, y: window.scrollY });
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);
  return pos;
}

/** Returns current window dimensions, updates on resize */
export function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const handler = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, []);
  return size;
}

/** Simple boolean toggle */
export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn(v => !v), []);
  return [on, toggle, setOn] as const;
}

/** Tracks whether element is in viewport */
export function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), options);
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [options]);
  return [ref, inView] as const;
}

/** Detects click outside a ref'd element */
export function useClickOutside(handler: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [handler]);
  return ref;
}
```

---

### `_data.ts`

```ts
import { useState, useEffect, useCallback, useRef } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Generic data fetcher with loading/error state.
 * Integrates with the ID-keyed cache layer (see 04_CACHING_STRATEGY.md).
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
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
      if (id === runRef.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (id === runRef.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  return { data, loading, error, refetch: run };
}
```

---

## 4. Migration Steps

1. Run the hook audit grep commands above.
2. For each existing hook file, move its logic into the appropriate `_*.ts` file, resolving any naming conflicts.
3. Replace the original import paths in every component with `@/hooks`.
4. Delete the original hook files.
5. Run `npx knip` to confirm no stale exports remain.
6. Run TypeScript (`tsc --noEmit`) to confirm no type errors.

---

## 5. Naming Conventions

| Pattern | Example |
|---------|---------|
| `use[Noun]` | `useAuth`, `useModal`, `useToast` |
| `use[Noun][Verb]` | `useFormSubmit`, `useCacheInvalidate` |
| `use[Adjective][Noun]` | `useDebounced`, `usePrevious` |

**Never:**
- `useGetXxx` (redundant — all hooks "get" something)
- `useXxxHook` (redundant suffix)
- `UseXxx` (must be camelCase)

---

## 6. Checklist

- [ ] Hook audit complete — all hooks catalogued
- [ ] `src/hooks/` directory created with category files
- [ ] `index.ts` barrel file created
- [ ] All hooks migrated to category files
- [ ] All component imports updated to `@/hooks`
- [ ] Original hook files deleted
- [ ] TypeScript clean — `tsc --noEmit` passes
- [ ] `knip` reports zero unused hook exports
- [ ] JSDoc on every exported hook
