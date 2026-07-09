/**
 * DB-free unit tests for embedText — fake fetch, no env, no network.
 * Run: node --import tsx --test src/lib/ai/embed.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { embedText, type EmbedDeps } from './embed';
import { EMBEDDING_DIMS, type AiProviderConfig } from './provider';

const CONFIG: AiProviderConfig = {
  baseURL: 'https://gw.example/v1',
  apiKey: 'k',
  model: 'openai/text-embedding-3-small',
};

interface FetchCall {
  url: string;
  body: { model: string; input: string[]; dimensions: number };
  headers: Record<string, string>;
}

function fakes(opts: {
  vectorOf?: (text: string, indexInBatch: number) => number[];
  status?: number;
  shuffle?: boolean;
  neverResolve?: boolean;
} = {}) {
  const calls: FetchCall[] = [];
  const vectorOf = opts.vectorOf ?? (() => new Array(EMBEDDING_DIMS).fill(0.5));

  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as FetchCall['body'];
    calls.push({ url: String(url), body, headers: (init?.headers ?? {}) as Record<string, string> });

    if (opts.neverResolve) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
        );
      });
    }
    if (opts.status && opts.status !== 200) {
      return new Response('boom', { status: opts.status });
    }

    let data = body.input.map((text, i) => ({ index: i, embedding: vectorOf(text, i) }));
    if (opts.shuffle) data = [...data].reverse();
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;

  const deps: Partial<EmbedDeps> = {
    resolveConfig: () => CONFIG,
    fetchImpl,
  };
  return { deps, calls };
}

test('happy path: returns one 768-dim vector per input, in input order', async () => {
  const f = fakes({
    vectorOf: (_text, i) => {
      const v = new Array(EMBEDDING_DIMS).fill(0);
      v[0] = i; // marker so order is verifiable
      return v;
    },
  });
  const out = await embedText(['alpha', 'beta'], f.deps);
  assert.equal(out.length, 2);
  assert.equal(out[0][0], 0);
  assert.equal(out[1][0], 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://gw.example/v1/embeddings');
  assert.deepEqual(f.calls[0].body.input, ['alpha', 'beta']);
  assert.equal(f.calls[0].body.dimensions, EMBEDDING_DIMS);
  assert.equal(f.calls[0].body.model, CONFIG.model);
  assert.equal(f.calls[0].headers.authorization, 'Bearer k');
});

test('out-of-order response rows are re-sorted by index', async () => {
  const f = fakes({
    vectorOf: (_text, i) => {
      const v = new Array(EMBEDDING_DIMS).fill(0);
      v[0] = i;
      return v;
    },
    shuffle: true,
  });
  const out = await embedText(['a', 'b', 'c'], f.deps);
  assert.deepEqual(out.map((v) => v[0]), [0, 1, 2]);
});

test('batching: splits inputs across requests at batchSize', async () => {
  const f = fakes();
  const out = await embedText(['1', '2', '3', '4', '5'], { ...f.deps, batchSize: 2 });
  assert.equal(out.length, 5);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map((c) => c.body.input.length), [2, 2, 1]);
});

test('empty input short-circuits without resolving config or fetching', async () => {
  let resolved = false;
  const out = await embedText([], {
    resolveConfig: () => {
      resolved = true;
      return CONFIG;
    },
    fetchImpl: (() => {
      throw new Error('must not fetch');
    }) as typeof fetch,
  });
  assert.deepEqual(out, []);
  assert.equal(resolved, false);
});

test('wrong dimensionality throws (dim assertion is the poison guard)', async () => {
  const f = fakes({ vectorOf: () => new Array(1536).fill(0.1) });
  await assert.rejects(() => embedText(['x'], f.deps), /dim mismatch.*1536.*768/s);
});

test('vector-count mismatch throws', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: [{ index: 0, embedding: new Array(EMBEDDING_DIMS).fill(0) }] }), {
      status: 200,
    })) as typeof fetch;
  await assert.rejects(
    () => embedText(['x', 'y'], { resolveConfig: () => CONFIG, fetchImpl }),
    /expected 2 vectors, got 1/,
  );
});

test('non-2xx response throws with status', async () => {
  const f = fakes({ status: 503 });
  await assert.rejects(() => embedText(['x'], f.deps), /503/);
});

test('timeout aborts and surfaces as a failed request', async () => {
  const f = fakes({ neverResolve: true });
  await assert.rejects(
    () => embedText(['x'], { ...f.deps, timeoutMs: 20 }),
    /Embedding request failed/,
  );
});
