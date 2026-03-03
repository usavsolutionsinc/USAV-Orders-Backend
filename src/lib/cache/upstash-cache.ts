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

/** Execute a single Redis command via the pipeline endpoint. */
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

/**
 * Execute multiple Redis commands in a single pipeline HTTP call.
 * Returns results in the same order as the commands array.
 */
async function runRedisPipeline<T = unknown>(commands: string[][]): Promise<(T | null)[]> {
  if (!isConfigured() || commands.length === 0) return [];
  const res = await fetch(buildUrl('pipeline'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Upstash Redis pipeline failed: ${res.status}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) {
    return data.map((item) => (item?.result as T) ?? null);
  }
  return [];
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

/**
 * Write a JSON value to cache with TTL and optional tag membership.
 * All Redis commands (SET + N×SADD + N×EXPIRE) are sent in a single pipeline call.
 */
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
    const commands: string[][] = [
      ['set', fullKey, serialized, 'EX', String(ttlSeconds)],
    ];
    for (const tag of tags) {
      if (!tag) continue;
      const fullTagKey = tagKey(tag);
      commands.push(['sadd', fullTagKey, fullKey]);
      commands.push(['expire', fullTagKey, String(Math.max(ttlSeconds * 4, 300))]);
    }
    await runRedisPipeline(commands);
  } catch (error) {
    console.warn('Cache write failed:', error);
  }
}

/**
 * Invalidate all cache keys belonging to the given tags.
 * Uses 2 pipeline round-trips regardless of how many tags/keys exist:
 *   Round 1 — SMEMBERS for all tags (get key lists)
 *   Round 2 — DEL all discovered keys + DEL the tag sets themselves
 */
export async function invalidateCacheTags(tags: string[]) {
  if (!isConfigured() || tags.length === 0) return;
  const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
  try {
    // Round 1: fetch all tag members in one pipeline call
    const smembersCommands = uniqueTags.map((tag) => ['smembers', tagKey(tag)]);
    const memberResults = await runRedisPipeline<string[]>(smembersCommands);

    // Round 2: DEL all cache keys + DEL the tag sets in one pipeline call
    const delCommands: string[][] = [];
    memberResults.forEach((keys) => {
      if (Array.isArray(keys) && keys.length > 0) {
        delCommands.push(['del', ...keys]);
      }
    });
    uniqueTags.forEach((tag) => {
      delCommands.push(['del', tagKey(tag)]);
    });
    if (delCommands.length > 0) {
      await runRedisPipeline(delCommands);
    }
  } catch (error) {
    console.warn('Cache invalidation failed:', error);
  }
}
