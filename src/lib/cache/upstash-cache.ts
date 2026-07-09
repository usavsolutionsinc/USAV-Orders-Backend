/**
 * Upstash Redis JSON cache — v2, org-scoped (Phase 0.2 / 0.3).
 *
 * The house cross-instance cache: cache-aside reads, invalidate-on-write, fail-open,
 * unconfigured-noop. Built on the consolidated REST client (`src/lib/redis/client.ts`).
 *
 * ── The v2 correctness fix ──────────────────────────────────────────────────
 * v1 folded orgId into the *key* but its *tags were global*, so
 * `invalidateCacheTags(['receiving-lines'])` flushed every tenant. v2 makes BOTH
 * the key and the tag org-scoped:
 *     key = cache:v2:{ns}:{orgId}:{key}
 *     tag = cache_tags:v2:{tag}:{orgId}
 * New code calls the org forms: getCachedJson(ns, orgId, key),
 * setCachedJson(ns, orgId, key, val, ttl, tags), invalidateCacheTags(orgId, tags),
 * and — preferred — getOrSet(ns, orgId, key, ttl, tags, loader).
 *
 * ── Legacy compat ───────────────────────────────────────────────────────────
 * The ~100 pre-existing callers still use the org-less forms. Those route to a
 * GLOBAL_ORG sentinel, so their reads and invalidations still match each other
 * (blast radius unchanged from v1 — no regression) while they are migrated to the
 * org form incrementally. Overloads dispatch legacy vs org at runtime by arity/type.
 */
import { isRedisConfigured, redisPipeline } from '@/lib/redis/client';
import { isNamespaceCacheEnabled } from './cache-flags';
import {
  recordCacheError,
  recordCacheHit,
  recordCacheMiss,
  recordCacheRebuild,
} from './cache-metrics';
import { acquireCacheLock, sleep } from '@/lib/redis/cache-lock';

// Environment segment: a single Upstash instance is shared across production,
// preview, and local dev, so keys AND tag-sets are namespaced per env. This makes
// it safe to run the cache everywhere at once — dev browsing (or a preview
// deploy) can never read, overwrite, or tag-invalidate a production entry.
// VERCEL_ENV is 'production' | 'preview' | 'development' on Vercel; off-platform
// it falls back to NODE_ENV / 'local'. (New segment ⇒ one cold re-warm on rollout.)
const CACHE_ENV = (process.env.VERCEL_ENV || process.env.NODE_ENV || 'local').toLowerCase();
const CACHE_PREFIX = `cache:v2:${CACHE_ENV}:`;
const TAG_PREFIX = `cache_tags:v2:${CACHE_ENV}:`;

/** Sentinel org for legacy (org-less) callers. Keys already embed org, so a
 *  single shared sentinel preserves v1 read↔invalidation matching. */
const GLOBAL_ORG = '_global';

function fullKey(namespace: string, orgId: string, key: string): string {
  return `${CACHE_PREFIX}${namespace}:${orgId}:${key}`;
}

function fullTagKey(tag: string, orgId: string): string {
  return `${TAG_PREFIX}${tag}:${orgId}`;
}

export function createCacheLookupKey(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}=${String(params[k] ?? '')}`).join('&');
}

// ── Internal core (fully resolved orgId) ─────────────────────────────────────

async function getCore<T>(namespace: string, orgId: string, key: string): Promise<T | null> {
  if (!orgId) return null;
  try {
    const [raw] = await redisPipeline<string>([['get', fullKey(namespace, orgId, key)]]);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn('Cache read failed:', error);
    return null;
  }
}

async function setCore(
  namespace: string,
  orgId: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  tags: string[],
): Promise<void> {
  if (!isRedisConfigured() || !orgId) return;
  const fk = fullKey(namespace, orgId, key);
  try {
    const commands: (string | number)[][] = [['set', fk, JSON.stringify(value), 'EX', String(ttlSeconds)]];
    for (const tag of tags) {
      if (!tag) continue;
      const tk = fullTagKey(tag, orgId);
      commands.push(['sadd', tk, fk]);
      commands.push(['expire', tk, String(Math.max(ttlSeconds * 4, 300))]);
    }
    await redisPipeline(commands);
  } catch (error) {
    console.warn('Cache write failed:', error);
  }
}

async function invalidateCore(orgId: string, tags: string[]): Promise<void> {
  if (!isRedisConfigured() || !orgId || tags.length === 0) return;
  const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
  if (uniqueTags.length === 0) return;
  try {
    // Round 1 — SMEMBERS for every (tag, org) set.
    const memberResults = await redisPipeline<string[]>(
      uniqueTags.map((tag) => ['smembers', fullTagKey(tag, orgId)]),
    );
    // Round 2 — DEL all discovered cache keys + DEL the tag sets themselves.
    const delCommands: (string | number)[][] = [];
    memberResults.forEach((keys) => {
      if (Array.isArray(keys) && keys.length > 0) delCommands.push(['del', ...keys]);
    });
    uniqueTags.forEach((tag) => delCommands.push(['del', fullTagKey(tag, orgId)]));
    if (delCommands.length > 0) await redisPipeline(delCommands);
  } catch (error) {
    console.warn('Cache invalidation failed:', error);
  }
}

// ── Public API (overloaded: legacy org-less + org-scoped) ────────────────────

export function getCachedJson<T>(namespace: string, key: string): Promise<T | null>;
export function getCachedJson<T>(namespace: string, orgId: string, key: string): Promise<T | null>;
export function getCachedJson<T>(namespace: string, a: string, b?: string): Promise<T | null> {
  return b === undefined ? getCore<T>(namespace, GLOBAL_ORG, a) : getCore<T>(namespace, a, b);
}

export function setCachedJson(
  namespace: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  tags?: string[],
): Promise<void>;
export function setCachedJson(
  namespace: string,
  orgId: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  tags?: string[],
): Promise<void>;
export function setCachedJson(
  namespace: string,
  a: string,
  b: unknown,
  c: unknown,
  d?: unknown,
  e?: unknown,
): Promise<void> {
  // Legacy: (ns, key, value, ttl:number, tags?). Org: (ns, orgId, key, value, ttl:number, tags?).
  // ttl is always a number → its position disambiguates the two overloads.
  if (typeof c === 'number') {
    return setCore(namespace, GLOBAL_ORG, a, b, c, (d as string[]) ?? []);
  }
  return setCore(namespace, a, b as string, c, d as number, (e as string[]) ?? []);
}

export function invalidateCacheTags(tags: string[]): Promise<void>;
export function invalidateCacheTags(orgId: string, tags: string[]): Promise<void>;
export function invalidateCacheTags(a: string | string[], b?: string[]): Promise<void> {
  return Array.isArray(a) ? invalidateCore(GLOBAL_ORG, a) : invalidateCore(a, b ?? []);
}

/**
 * Cache-aside read-through with single-flight rebuild (Phase 0.3). The workhorse
 * new code should use. Org-scoped; kill-switch/namespace-gated; fail-open.
 *
 *   hit  → return cached value.
 *   miss → acquire single-flight lock → re-check → loader() → setCachedJson → return.
 *   disabled / no-org / any Redis error → run loader() directly (no caching).
 */
export async function getOrSet<T>(
  namespace: string,
  orgId: string,
  key: string,
  ttlSeconds: number,
  tags: string[],
  loader: () => Promise<T>,
): Promise<T> {
  if (!orgId || !isNamespaceCacheEnabled(namespace) || !isRedisConfigured()) {
    return loader();
  }

  const hit = await getCore<T>(namespace, orgId, key);
  if (hit !== null) {
    recordCacheHit(namespace);
    return hit;
  }
  recordCacheMiss(namespace);

  const lockName = `${namespace}:${orgId}:${key}`;
  const handle = await acquireCacheLock(lockName);
  if (handle === null) {
    // Another caller is rebuilding — wait briefly and read their result.
    await sleep(60);
    const second = await getCore<T>(namespace, orgId, key);
    if (second !== null) {
      recordCacheHit(namespace);
      return second;
    }
    // Still cold → rebuild without a lock (fail-open).
    return rebuild(namespace, orgId, key, ttlSeconds, tags, loader);
  }

  try {
    // Re-check: the winner may have filled the key between our miss and lock.
    const filled = await getCore<T>(namespace, orgId, key);
    if (filled !== null) {
      recordCacheHit(namespace);
      return filled;
    }
    return await rebuild(namespace, orgId, key, ttlSeconds, tags, loader);
  } finally {
    await handle.release();
  }
}

async function rebuild<T>(
  namespace: string,
  orgId: string,
  key: string,
  ttlSeconds: number,
  tags: string[],
  loader: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  let value: T;
  try {
    value = await loader();
  } catch (err) {
    recordCacheError(namespace);
    throw err;
  }
  recordCacheRebuild(namespace, Date.now() - started);
  await setCore(namespace, orgId, key, value, ttlSeconds, tags);
  return value;
}
