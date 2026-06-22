import test from 'node:test';
import assert from 'node:assert/strict';

// Configure the lock BEFORE importing it (the module reads the env at eval
// time). Dynamic import() below picks these up; a static import would hoist
// above these assignments and capture the unconfigured (no-op) path instead.
process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

type PipelineBody = Array<Array<string | number>>;
interface Captured {
  url: string;
  command: Array<string | number>;
}

/** Stub global fetch; `handler(command)` returns the Redis `result` value. */
function stubFetch(handler: (command: Array<string | number>) => unknown): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as PipelineBody;
    const command = body[0];
    calls.push({ url: String(url), command });
    return {
      ok: true,
      json: async () => [{ result: handler(command) }],
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

async function loadLock() {
  const mod = await import('./lock');
  return mod.redisAdvanceLock;
}

test('lock: acquire issues SET … NX PX and returns true when Redis says OK', async () => {
  const calls = stubFetch((cmd) => (cmd[0] === 'SET' ? 'OK' : 0));
  const lock = await loadLock();

  const ok = await lock.acquire('wf:advance:101');

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/pipeline$/);
  const cmd = calls[0].command;
  assert.equal(cmd[0], 'SET');
  assert.equal(cmd[1], 'wf:advance:101');
  assert.ok(cmd.includes('NX'), 'must SET with NX');
  assert.ok(cmd.includes('PX'), 'must SET with a TTL');
});

test('lock: acquire returns false (no throw) when the key is already held', async () => {
  stubFetch(() => null); // SET NX miss → Redis returns null
  const lock = await loadLock();

  const ok = await lock.acquire('wf:advance:102');

  assert.equal(ok, false);
});

test('lock: acquire fails OPEN (returns true) when Redis is unreachable', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const lock = await loadLock();

  const ok = await lock.acquire('wf:advance:103');

  assert.equal(ok, true); // never stall a fire-and-forget tap on an infra hiccup
});

test('lock: release does a token-checked compare-and-delete of the held key', async () => {
  const calls = stubFetch((cmd) => (cmd[0] === 'SET' ? 'OK' : 1));
  const lock = await loadLock();

  await lock.acquire('wf:advance:104');
  const setToken = calls[0].command[2]; // the token we wrote
  calls.length = 0;

  await lock.release('wf:advance:104');

  assert.equal(calls.length, 1);
  const cmd = calls[0].command;
  assert.equal(cmd[0], 'EVAL');
  assert.equal(cmd[2], '1'); // numkeys
  assert.equal(cmd[3], 'wf:advance:104'); // KEYS[1]
  assert.equal(cmd[4], setToken); // ARGV[1] — compare-and-delete our exact token
});

test('lock: release is a no-op when we never acquired the key', async () => {
  // A second concurrent advance gets a NX miss and never holds a token; its
  // release must NOT delete the first advance's live lock.
  stubFetch(() => null);
  const lock = await loadLock();
  await lock.acquire('wf:advance:105'); // false — no token stored

  const calls = stubFetch(() => 1);
  await lock.release('wf:advance:105');

  assert.equal(calls.length, 0);
});
