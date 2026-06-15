/**
 * Rate limiter — distributed when Upstash Redis is configured, in-memory
 * fallback otherwise. The previous implementation was an in-process `Map`
 * which broke under Vercel's autoscaler: each Lambda instance had its own
 * Map, so the effective limit was `limit × instances`.
 *
 * Public API is unchanged — `checkRateLimit({ headers, routeKey, limit,
 * windowMs })` still returns `{ ok, retryAfterSec? }`. The new
 * `checkRateLimitAsync` variant uses the distributed backend; the sync
 * `checkRateLimit` keeps the in-memory path so legacy callsites don't break,
 * but new code should prefer the async form.
 *
 * Backend selection:
 *   - If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set, all
 *     async calls use Redis (sliding window via ZSET).
 *   - Otherwise the in-memory Map is used (fine for local dev, NOT fine
 *     for production multi-instance).
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_PREFIX = 'rl:v1:';

function isRedisConfigured(): boolean {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

// Loud boot warning: in production, an unconfigured Redis means the limiter
// silently falls back to a per-instance in-memory Map — effectively OFF under
// Vercel autoscale (the real limit becomes limit × instances). Surface it so a
// missing UPSTASH_REDIS_* in prod is caught instead of silently failing open.
if (!isRedisConfigured() && (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production')) {
  console.warn(
    '[api-guard] UPSTASH_REDIS_REST_URL/_TOKEN are not set in production — rate limiting is falling back to per-instance in-memory and is INEFFECTIVE under autoscale. Configure Upstash Redis.',
  );
}

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') || 'unknown';
}

export interface RateLimitOptions {
  headers: Headers;
  routeKey: string;
  limit: number;
  windowMs: number;
  /** Optional extra identifier (e.g. orgId, staffId) to scope the limit. */
  scope?: string | number | null;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
}

function buildKey(opts: RateLimitOptions): string {
  const ip = getClientIp(opts.headers);
  const scope = opts.scope == null ? '' : `:${opts.scope}`;
  return `${opts.routeKey}${scope}:${ip}`;
}

/**
 * Legacy synchronous in-memory limiter. Kept for backwards compatibility
 * with existing callsites. Migrate to checkRateLimitAsync when convenient —
 * the async variant is the only one safe across Vercel/serverless instances.
 */
export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const key = buildKey(opts);

  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true };
  }

  if (current.count >= opts.limit) {
    return { ok: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return { ok: true };
}

/**
 * Distributed sliding-window limiter. Uses Redis ZSET semantics: each call
 * appends now-ms as a score, expires old entries past windowMs, counts the
 * remaining elements. Falls back to checkRateLimit() if Redis isn't
 * configured.
 */
export async function checkRateLimitAsync(opts: RateLimitOptions): Promise<RateLimitResult> {
  if (!isRedisConfigured()) return checkRateLimit(opts);

  const now = Date.now();
  const key = `${REDIS_PREFIX}${buildKey(opts)}`;
  const cutoff = now - opts.windowMs;
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    const res = await fetch(`${REDIS_URL.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['ZREMRANGEBYSCORE', key, '-inf', String(cutoff)],
        ['ZADD', key, String(now), member],
        ['ZCARD', key],
        ['PEXPIRE', key, String(opts.windowMs)],
      ]),
      cache: 'no-store',
    });

    if (!res.ok) {
      // Don't fail-closed on Redis hiccups — log and fall back.
      console.warn(`[api-guard] redis pipeline failed: ${res.status}`);
      return checkRateLimit(opts);
    }

    const data = (await res.json()) as Array<{ result: unknown }> | { result: unknown };
    const results = Array.isArray(data) ? data : [data];
    const count = Number((results[2] as { result?: unknown } | undefined)?.result ?? 0);

    if (count > opts.limit) {
      return { ok: false, retryAfterSec: Math.ceil(opts.windowMs / 1000) };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[api-guard] redis call failed:', err instanceof Error ? err.message : err);
    return checkRateLimit(opts);
  }
}

/**
 * Org-scoped rate limit for authed routes. Combines the IP dimension (within-
 * tenant abuse) with the tenant org so one noisy tenant can't exhaust another
 * tenant's budget on a shared routeKey. Prefer this on withAuth routes — pass
 * `ctx.organizationId`. Public / pre-auth routes (e.g. auth/signup) stay
 * IP-only via `checkRateLimitAsync`. See tenancy exec plan §D5.
 */
export function checkRateLimitForOrg(
  opts: Omit<RateLimitOptions, 'scope'> & { organizationId: string },
): Promise<RateLimitResult> {
  return checkRateLimitAsync({ ...opts, scope: opts.organizationId });
}
