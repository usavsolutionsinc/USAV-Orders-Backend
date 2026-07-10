/**
 * Consolidated Upstash Redis REST client (Phase 0.1 of the Redis caching plan).
 *
 * Single source for talking to Upstash over its REST `/pipeline` endpoint.
 * Extracted from the three copy-pasted helpers that predate this module
 * (`cache/upstash-cache.ts`, `workflow/lock.ts`, `api-guard.ts`) so there is one
 * place that knows the URL/token, the request shape, and the fail-open contract.
 *
 * Contract:
 *   - `isRedisConfigured()` is false when the env vars are unset (local/CI/preview).
 *     Every consumer must treat "not configured" as "run the DB path" — this module
 *     never throws for the unconfigured case; `redisCmd`/`redisPipeline` return null/[]/.
 *   - HTTP or Redis-level errors DO throw (or reject). Callers wrap in try/catch and
 *     fail open. This module is deliberately thin: it does transport, not policy.
 */
export type RedisCommand = (string | number)[];

/**
 * Resolve Upstash REST credentials from EITHER naming convention. Pure and
 * env-injectable so the resolution rule is unit-testable (client.test.ts):
 *   • UPSTASH_REDIS_REST_URL / _TOKEN — Upstash's own integration
 *   • KV_REST_API_URL / KV_REST_API_TOKEN — Vercel-KV / marketplace naming
 * Both point at the same Upstash REST endpoint and speak the same `/pipeline`
 * protocol, so either lights up the cache + distributed rate limiter + workflow
 * lock. Reading only UPSTASH_* silently disabled ALL of them when the env only
 * had KV_REST_API_* (the 2026-07 shipped-table + rate-limit regression). Always
 * the read/write token — never KV_REST_API_READ_ONLY_TOKEN (it can't SET). The
 * url has any trailing slash stripped; both are '' when unconfigured.
 */
export function resolveRedisRestCreds(
  env: Record<string, string | undefined> = process.env,
): { url: string; token: string } {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').replace(/\/+$/, '');
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  return { url, token };
}

const { url: REST_URL, token: REST_TOKEN } = resolveRedisRestCreds();

export function isRedisConfigured(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
}

/**
 * The resolved REST target ({ url, token }). One source of truth so health
 * probes and other consumers never re-read `process.env` (and re-introduce a
 * naming mismatch). `url` has any trailing slash stripped; both are '' when
 * unconfigured.
 */
export function redisRestTarget(): { url: string; token: string } {
  return { url: REST_URL, token: REST_TOKEN };
}

// Loud, once-per-process tripwire: an unconfigured Redis means every cache-aside
// path, the distributed rate limiter, and the workflow lock silently degrade to
// the DB / in-memory fallback. Surface it at boot instead of failing open in
// silence — the exact failure mode that hid the regression above. Server-only;
// skipped in tests.
if (typeof window === 'undefined' && !isRedisConfigured() && process.env.NODE_ENV !== 'test') {
  console.warn(
    '[redis] No Upstash REST creds found (checked UPSTASH_REDIS_REST_URL/TOKEN and ' +
      'KV_REST_API_URL/TOKEN). Cache, distributed rate limiting, and workflow locks ' +
      'are DISABLED — all paths run their DB / in-memory fallback.',
  );
}

function pipelineUrl(): string {
  return `${REST_URL}/pipeline`;
}

/**
 * Execute N Redis commands in one pipeline HTTP round-trip.
 * Returns results in command order (null for a null result). Returns [] when
 * Redis is unconfigured or no commands are supplied. Throws on HTTP failure or
 * a Redis-level error in any command — callers fail open.
 */
export async function redisPipeline<T = unknown>(commands: RedisCommand[]): Promise<(T | null)[]> {
  if (!isRedisConfigured() || commands.length === 0) return [];
  const res = await fetch(pipelineUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`upstash pipeline failed: ${res.status}`);
  const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    if (item?.error) throw new Error(item.error);
    return (item?.result as T) ?? null;
  });
}

/**
 * Execute a single Redis command; returns its result (null for a null result,
 * null when unconfigured). Throws on HTTP failure or a Redis-level error.
 */
export async function redisCmd<T = unknown>(command: RedisCommand): Promise<T | null> {
  if (!isRedisConfigured()) return null;
  const [first] = await redisPipeline<T>([command]);
  return first ?? null;
}
