const REST_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const CACHE_PREFIX = 'cache:v1:';
const TAG_PREFIX = 'cache_tags:v1:';

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

function buildUrl(path: string) {
  return `${REST_URL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function runRedis<T = unknown>(parts: string[]): Promise<T | null> {
  if (!isConfigured()) return null;
  const res = await fetch(buildUrl('pipeline'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([parts]),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Upstash Redis request failed: ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    return (data[0]?.result as T) ?? null;
  }
  return (data?.result as T) ?? null;
}

function cacheKey(namespace: string, key: string) {
  return `${CACHE_PREFIX}${namespace}:${key}`;
}

function tagKey(tag: string) {
  return `${TAG_PREFIX}${tag}`;
}

export function createCacheLookupKey(params: Record<string, string | number | boolean | null | undefined>) {
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}=${String(params[k] ?? '')}`).join('&');
}

export async function getCachedJson<T>(namespace: string, key: string): Promise<T | null> {
  try {
    const raw = await runRedis<string>(['get', cacheKey(namespace, key)]);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn('Cache read failed:', error);
    return null;
  }
}

export async function setCachedJson(
  namespace: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  tags: string[] = []
) {
  if (!isConfigured()) return;
  const fullKey = cacheKey(namespace, key);
  const serialized = JSON.stringify(value);
  try {
    await runRedis(['set', fullKey, serialized, 'EX', String(ttlSeconds)]);
    for (const tag of tags) {
      if (!tag) continue;
      const fullTagKey = tagKey(tag);
      await runRedis(['sadd', fullTagKey, fullKey]);
      await runRedis(['expire', fullTagKey, String(Math.max(ttlSeconds * 4, 300))]);
    }
  } catch (error) {
    console.warn('Cache write failed:', error);
  }
}

export async function invalidateCacheTags(tags: string[]) {
  if (!isConfigured() || tags.length === 0) return;
  const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
  for (const tag of uniqueTags) {
    try {
      const fullTagKey = tagKey(tag);
      const keys = (await runRedis<string[]>(['smembers', fullTagKey])) || [];
      if (keys.length > 0) {
        await runRedis(['del', ...keys]);
      }
      await runRedis(['del', fullTagKey]);
    } catch (error) {
      console.warn(`Cache invalidation failed for tag "${tag}":`, error);
    }
  }
}
