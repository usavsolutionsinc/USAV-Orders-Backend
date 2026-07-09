import test from 'node:test';
import assert from 'node:assert/strict';

// Configure Redis BEFORE importing the cache modules — they read env at eval time.
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
delete process.env.REDIS_CACHE_DISABLED;
delete process.env.REDIS_CACHE_NS;

type Cmd = Array<string | number>;

/**
 * Minimal in-memory Redis over the Upstash /pipeline wire shape. Supports the
 * command subset the cache + lock use (case-insensitive). No TTL expiry.
 */
function makeFakeRedis() {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  let failNext = false;

  function exec(cmd: Cmd): unknown {
    const op = String(cmd[0]).toLowerCase();
    switch (op) {
      case 'get':
        return kv.get(String(cmd[1])) ?? null;
      case 'set': {
        const key = String(cmd[1]);
        const val = String(cmd[2]);
        const rest = cmd.slice(3).map((x) => String(x).toUpperCase());
        if (rest.includes('NX') && kv.has(key)) return null; // SET NX miss
        kv.set(key, val);
        return 'OK';
      }
      case 'sadd': {
        const key = String(cmd[1]);
        let s = sets.get(key);
        if (!s) sets.set(key, (s = new Set()));
        for (let i = 2; i < cmd.length; i++) s.add(String(cmd[i]));
        return 1;
      }
      case 'smembers':
        return Array.from(sets.get(String(cmd[1])) ?? []);
      case 'expire':
        return 1;
      case 'del': {
        let n = 0;
        for (let i = 1; i < cmd.length; i++) {
          const key = String(cmd[i]);
          if (kv.delete(key)) n++;
          if (sets.delete(key)) n++;
        }
        return n;
      }
      case 'eval': {
        // CAS-delete: EVAL lua 1 key token
        const key = String(cmd[3]);
        kv.delete(key);
        return 1;
      }
      default:
        return null;
    }
  }

  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    if (failNext) {
      failNext = false;
      throw new Error('ECONNREFUSED');
    }
    const commands = JSON.parse(init.body) as Cmd[];
    return {
      ok: true,
      json: async () => commands.map((c) => ({ result: exec(c) })),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return {
    kv,
    sets,
    breakOnce() {
      failNext = true;
    },
  };
}

async function loadCache() {
  return import('./upstash-cache');
}

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

test('getOrSet: miss loads once + caches; hit returns cached without loader', async () => {
  makeFakeRedis();
  const { getOrSet } = await loadCache();
  let calls = 0;
  const loader = async () => {
    calls++;
    return { v: 42 };
  };

  const first = await getOrSet('ns-a', ORG_A, 'k1', 60, ['t1'], loader);
  const second = await getOrSet('ns-a', ORG_A, 'k1', 60, ['t1'], loader);

  assert.deepEqual(first, { v: 42 });
  assert.deepEqual(second, { v: 42 });
  assert.equal(calls, 1, 'loader runs once; second call is a cache hit');
});

test('getOrSet: single-flight — concurrent cold misses load once', async () => {
  makeFakeRedis();
  const { getOrSet } = await loadCache();
  let calls = 0;
  const loader = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return { n: calls };
  };

  const [a, b] = await Promise.all([
    getOrSet('ns-sf', ORG_A, 'hot', 60, [], loader),
    getOrSet('ns-sf', ORG_A, 'hot', 60, [], loader),
  ]);

  assert.equal(calls, 1, 'exactly one rebuild wins the single-flight lock');
  assert.deepEqual(a, b);
});

test('cross-org isolation: org-A invalidation leaves org-B keys intact', async () => {
  makeFakeRedis();
  const { setCachedJson, getCachedJson, invalidateCacheTags } = await loadCache();

  await setCachedJson('ns-x', ORG_A, 'k', { org: 'A' }, 60, ['shared-tag']);
  await setCachedJson('ns-x', ORG_B, 'k', { org: 'B' }, 60, ['shared-tag']);

  // Invalidating org-A's tag must NOT touch org-B.
  await invalidateCacheTags(ORG_A, ['shared-tag']);

  assert.equal(await getCachedJson('ns-x', ORG_A, 'k'), null, 'org-A busted');
  assert.deepEqual(await getCachedJson('ns-x', ORG_B, 'k'), { org: 'B' }, 'org-B untouched');
});

test('cross-org isolation: a read for org-A never returns org-B payload', async () => {
  makeFakeRedis();
  const { setCachedJson, getCachedJson } = await loadCache();

  await setCachedJson('ns-y', ORG_B, 'same-key', { secret: 'B' }, 60, []);

  assert.equal(await getCachedJson('ns-y', ORG_A, 'same-key'), null);
  assert.deepEqual(await getCachedJson('ns-y', ORG_B, 'same-key'), { secret: 'B' });
});

test('legacy compat: org-less set/get/invalidate still round-trips', async () => {
  makeFakeRedis();
  const { setCachedJson, getCachedJson, invalidateCacheTags } = await loadCache();

  await setCachedJson('ns-legacy', 'lk', { legacy: true }, 60, ['legacy-tag']);
  assert.deepEqual(await getCachedJson('ns-legacy', 'lk'), { legacy: true });

  await invalidateCacheTags(['legacy-tag']);
  assert.equal(await getCachedJson('ns-legacy', 'lk'), null);
});

test('fail-open: a Redis error on read still returns the loader value', async () => {
  const fake = makeFakeRedis();
  const { getOrSet } = await loadCache();

  fake.breakOnce(); // first Redis op (the cache read) throws
  const value = await getOrSet('ns-fo', ORG_A, 'k', 60, [], async () => ({ fromDb: true }));
  assert.deepEqual(value, { fromDb: true });
});
