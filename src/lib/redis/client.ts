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

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

export function isRedisConfigured(): boolean {
  return Boolean(REST_URL && REST_TOKEN);
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
