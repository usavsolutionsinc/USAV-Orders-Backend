/**
 * Reusable single-flight cache lock (Phase 0.4).
 *
 * Generalizes the proven `redisAdvanceLock` shape (SET NX PX + token-checked
 * Lua CAS-delete) into a short-lived mutex used to collapse a cold-key stampede:
 * when a hot cache key expires under scan load, exactly one caller rebuilds it
 * while the others wait-and-read.
 *
 * Fail-open contract (identical to redisAdvanceLock): unconfigured or Redis
 * error → behave as if the lock was acquired (run the work). Correctness never
 * depends on the lock — the getOrSet re-check + idempotent loaders cover a rare
 * concurrent rebuild; the lock only narrows the stampede window.
 */
import { isRedisConfigured, redisCmd } from './client';

const DEFAULT_TTL_MS = 2_000;

const RELEASE_LUA =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

const heldTokens = new Map<string, string>();
let tokenSeq = 0;
function mintToken(): string {
  tokenSeq = (tokenSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `${process.pid.toString(36)}-${Date.now().toString(36)}-${tokenSeq.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function lockKey(key: string): string {
  return `cachelock:${key}`;
}

export interface CacheLockHandle {
  /** True when a real Redis lock is held (false = fail-open, ran without a lock). */
  readonly acquired: boolean;
  release(): Promise<void>;
}

/**
 * Try to acquire the single-flight lock for `key`.
 *  - Redis unconfigured / error  → { acquired: false } (caller proceeds, fail-open).
 *  - SET NX succeeds             → { acquired: true }  (caller is the rebuilder).
 *  - SET NX misses (held)        → returns null        (someone else is rebuilding).
 */
export async function acquireCacheLock(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<CacheLockHandle | null> {
  if (!isRedisConfigured()) return { acquired: false, release: async () => {} };
  const full = lockKey(key);
  const token = mintToken();
  try {
    const result = await redisCmd(['SET', full, token, 'NX', 'PX', String(ttlMs)]);
    if (result === 'OK') {
      heldTokens.set(full, token);
      return {
        acquired: true,
        release: async () => {
          const held = heldTokens.get(full);
          heldTokens.delete(full);
          if (!held) return;
          try {
            await redisCmd(['EVAL', RELEASE_LUA, '1', full, held]);
          } catch {
            /* TTL will expire it */
          }
        },
      };
    }
    // Lock is held by another rebuilder.
    return null;
  } catch {
    // Infra hiccup → fail open: proceed without a lock.
    return { acquired: false, release: async () => {} };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` under the single-flight lock for `key`. If the lock is held by
 * another caller, wait briefly then run `fn` anyway (fail-open — the caller is
 * expected to re-check its cache first). Primarily a building block for getOrSet.
 */
export async function withCacheLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const handle = await acquireCacheLock(key);
  if (handle === null) {
    await sleep(60);
    return fn();
  }
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}
