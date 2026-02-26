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

export function checkRateLimit(options: {
  headers: Headers;
  routeKey: string;
  limit: number;
  windowMs: number;
}): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const ip = getClientIp(options.headers);
  const key = `${options.routeKey}:${ip}`;

  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true };
  }

  if (current.count >= options.limit) {
    return { ok: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return { ok: true };
}
