/**
 * ID-keyed in-memory cache with TTL support and window event invalidation.
 *
 * Architecture:
 * - Cache store lives outside React's render cycle (singleton object)
 * - Invalidation fires custom window events so any mounted component can react
 *   without prop drilling or global state managers
 * - TTL-based expiry is checked lazily on read
 *
 * Usage:
 *   import { cacheGet, cacheSet, cacheInvalidate } from '@/lib/cache';
 *   import { useCache } from '@/hooks';
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  /** Absolute timestamp (ms) when this entry expires. null = never. */
  expiresAt: number | null;
  createdAt: number;
}

type CacheStore = Record<string, CacheEntry<unknown>>;

// ─── Constants ─────────────────────────────────────────────────────────────────

const EVENT_PREFIX = 'cache:invalidate:';

/** Default TTL: 5 minutes */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

// ─── Singleton store ────────────────────────────────────────────────────────────

const store: CacheStore = {};

// ─── Internal helpers ───────────────────────────────────────────────────────────

function buildKey(domain: string, id: string | number): string {
  return `${domain}:${id}`;
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  if (entry.expiresAt === null) return false;
  return Date.now() > entry.expiresAt;
}

// ─── Core API ───────────────────────────────────────────────────────────────────

/**
 * Writes a value into the cache under `domain:id`.
 *
 * @param domain  Logical namespace (e.g. 'order', 'staff', 'sku')
 * @param id      Entity identifier
 * @param value   Data to store
 * @param ttlMs   Time-to-live in ms. Pass null for a permanent entry.
 */
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

/**
 * Reads a value from the cache.
 * Returns undefined if the entry is missing, expired, or stale.
 */
export function cacheGet<T>(domain: string, id: string | number): T | undefined {
  const key = buildKey(domain, id);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry || isExpired(entry)) {
    delete store[key];
    return undefined;
  }
  return entry.value;
}

/**
 * Returns whether a valid (non-expired) entry exists for the given domain + id.
 */
export function cacheHas(domain: string, id: string | number): boolean {
  return cacheGet(domain, id) !== undefined;
}

/**
 * Invalidates a single cache entry and emits a window event so any subscribed
 * component can trigger a refetch.
 */
export function cacheInvalidate(domain: string, id: string | number): void {
  const key = buildKey(domain, id);
  delete store[key];
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(`${EVENT_PREFIX}${domain}`, { detail: { id } }),
    );
  }
}

/**
 * Invalidates ALL entries under a domain and emits a wildcard window event.
 * Use after bulk mutations (e.g. batch delete, import).
 */
export function cacheInvalidateDomain(domain: string): void {
  const prefix = `${domain}:`;
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) delete store[key];
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(`${EVENT_PREFIX}${domain}`, { detail: { id: '*' } }),
    );
  }
}

/**
 * Clears the entire cache store. Useful for logout / session reset.
 */
export function cacheClear(): void {
  for (const key of Object.keys(store)) delete store[key];
}

/**
 * Returns all non-expired entries for a domain as a Record<id, value>.
 */
export function cacheGetDomain<T>(domain: string): Record<string, T> {
  const prefix = `${domain}:`;
  const result: Record<string, T> = {};
  for (const [key, entry] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue;
    if (isExpired(entry)) {
      delete store[key];
      continue;
    }
    const id = key.slice(prefix.length);
    result[id] = entry.value as T;
  }
  return result;
}

/**
 * Subscribes to invalidation events for a domain.
 * Returns an unsubscribe function — call it in your cleanup.
 *
 * @example
 * useEffect(() => onCacheInvalidate('order', (id) => refetch()), []);
 */
export function onCacheInvalidate(
  domain: string,
  cb: (id: string | number | '*') => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) =>
    cb((e as CustomEvent<{ id: string | number | '*' }>).detail.id);
  window.addEventListener(`${EVENT_PREFIX}${domain}`, handler);
  return () => window.removeEventListener(`${EVENT_PREFIX}${domain}`, handler);
}
