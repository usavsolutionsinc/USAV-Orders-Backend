# 04 — Caching Strategy: ID-Keyed + Window Listener Invalidation

---

## Goals

- Replace all ad-hoc state caching with a unified, ID-keyed in-memory cache
- Invalidate cache entries via custom `window` events (cross-component, zero prop drilling)
- Support TTL-based expiry for time-sensitive data
- Provide a `useCache` hook as the single interface for all components
- Keep the cache outside React's render cycle for maximum performance

---

## 1. Core Cache Module

**Location:** `src/lib/cache.ts`

```ts
// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null; // null = never expires
  createdAt: number;
}

type CacheStore = Record<string, CacheEntry<unknown>>;

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_PREFIX = 'cache:invalidate:';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Singleton store (lives outside React) ────────────────────────────────────

const store: CacheStore = {};

// ─── Core API ─────────────────────────────────────────────────────────────────

function buildKey(domain: string, id: string | number): string {
  return `${domain}:${id}`;
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  if (entry.expiresAt === null) return false;
  return Date.now() > entry.expiresAt;
}

/** Write a value into the cache */
export function cacheSet<T>(
  domain: string,
  id: string | number,
  value: T,
  ttlMs: number | null = DEFAULT_TTL_MS,
): void {
  const key = buildKey(domain, id);
  store[key] = {
    value,
    expiresAt: ttlMs !== null ? Date.now() + ttlMs : null,
    createdAt: Date.now(),
  };
}

/** Read a value from the cache. Returns undefined if missing or expired. */
export function cacheGet<T>(domain: string, id: string | number): T | undefined {
  const key = buildKey(domain, id);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry || isExpired(entry)) {
    delete store[key];
    return undefined;
  }
  return entry.value;
}

/** Invalidate a single cache entry and emit a window event */
export function cacheInvalidate(domain: string, id: string | number): void {
  const key = buildKey(domain, id);
  delete store[key];
  window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${domain}`, { detail: { id } }));
}

/** Invalidate ALL entries for a domain */
export function cacheInvalidateDomain(domain: string): void {
  const prefix = `${domain}:`;
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) delete store[key];
  }
  window.dispatchEvent(new CustomEvent(`${EVENT_PREFIX}${domain}`, { detail: { id: '*' } }));
}

/** Clear the entire cache */
export function cacheClear(): void {
  for (const key of Object.keys(store)) delete store[key];
}

/** Subscribe to invalidation events for a domain.  Returns unsubscribe fn. */
export function onCacheInvalidate(
  domain: string,
  cb: (id: string | number | '*') => void,
): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<{ id: string | number | '*' }>).detail.id);
  window.addEventListener(`${EVENT_PREFIX}${domain}`, handler);
  return () => window.removeEventListener(`${EVENT_PREFIX}${domain}`, handler);
}
```

---

## 2. `useCache` Hook

**Location:** `src/hooks/_cache.ts`

```ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { cacheGet, cacheSet, onCacheInvalidate } from '@/lib/cache';

interface UseCacheOptions<T> {
  /** Domain name, e.g. 'user', 'post', 'dashboard' */
  domain: string;
  /** Entity ID — the cache key */
  id: string | number;
  /** Async function to load data when cache is empty/expired */
  fetcher: () => Promise<T>;
  /** TTL in ms. null = permanent. Default = 5 minutes */
  ttlMs?: number | null;
}

interface UseCacheReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /** Manually invalidate and refetch */
  invalidate: () => void;
}

export function useCache<T>({
  domain,
  id,
  fetcher,
  ttlMs,
}: UseCacheOptions<T>): UseCacheReturn<T> {
  const [data, setData] = useState<T | null>(() => cacheGet<T>(domain, id) ?? null);
  const [loading, setLoading] = useState<boolean>(data === null);
  const [error, setError] = useState<Error | null>(null);
  const runCount = useRef(0);

  const load = useCallback(async () => {
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
  }, [domain, id, fetcher, ttlMs]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Window event invalidation listener
  useEffect(() => {
    return onCacheInvalidate(domain, (invalidatedId) => {
      if (invalidatedId === '*' || invalidatedId === id) {
        load();
      }
    });
  }, [domain, id, load]);

  const invalidate = useCallback(() => {
    import('@/lib/cache').then(({ cacheInvalidate }) => {
      cacheInvalidate(domain, id);
      load();
    });
  }, [domain, id, load]);

  return { data, loading, error, invalidate };
}
```

---

## 3. Usage Patterns

### Reading cached data in a component

```tsx
import { useCache } from '@/hooks';
import { fetchUserById } from '@/api/users';

function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading, error, invalidate } = useCache({
    domain: 'user',
    id: userId,
    fetcher: () => fetchUserById(userId),
    ttlMs: 10 * 60 * 1000, // 10 minutes
  });

  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return (
    <div>
      <h1>{user?.name}</h1>
      <button onClick={invalidate}>Refresh</button>
    </div>
  );
}
```

---

### Invalidating from another component (cross-component, no prop drilling)

```tsx
import { cacheInvalidate } from '@/lib/cache';

function UpdateUserButton({ userId }: { userId: string }) {
  const handleUpdate = async () => {
    await updateUser(userId, newData);
    // Any component using useCache({ domain: 'user', id: userId }) will refetch
    cacheInvalidate('user', userId);
  };
  return <button onClick={handleUpdate}>Save</button>;
}
```

---

### Invalidating an entire domain after bulk operations

```tsx
import { cacheInvalidateDomain } from '@/lib/cache';

async function handleBulkDelete(ids: string[]) {
  await bulkDelete(ids);
  cacheInvalidateDomain('post'); // All post cache entries cleared + refetched
}
```

---

## 4. Window Event Architecture

```
Component A (mutation)         Component B (reads user:42)
      │                               │
      │ cacheInvalidate('user', 42)   │
      │                               │
      └──► window.dispatchEvent ─────►│ onCacheInvalidate listener fires
                                      │ load() triggered
                                      │ UI updates automatically
```

This approach means:
- Zero prop drilling of invalidation callbacks
- Zero need for global state managers (Redux, Zustand) for cache coordination
- Works across portals, modals, and deeply nested trees

---

## 5. Cache Domain Registry

Define all cache domains in one place:

**`src/lib/cacheDomains.ts`**

```ts
export const CACHE_DOMAINS = {
  USER: 'user',
  POST: 'post',
  COMMENT: 'comment',
  DASHBOARD: 'dashboard',
  SETTINGS: 'settings',
  MEDIA: 'media',
} as const;

export type CacheDomain = typeof CACHE_DOMAINS[keyof typeof CACHE_DOMAINS];
```

---

## 6. Checklist

- [ ] `src/lib/cache.ts` created and exported
- [ ] `src/lib/cacheDomains.ts` created
- [ ] `useCache` hook added to `src/hooks/_cache.ts` and exported from barrel
- [ ] All data-fetching components migrated from ad-hoc `useState` to `useCache`
- [ ] All mutation handlers call `cacheInvalidate` or `cacheInvalidateDomain`
- [ ] TTL values documented per domain in `cacheDomains.ts`
- [ ] No direct reads/writes to `store` from outside `cache.ts`
