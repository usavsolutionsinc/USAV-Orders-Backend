/**
 * Local vision box client — config resolution precedence, response normalization
 * (damage derivation, caps, caption fallback), and the fetch contract incl. every
 * degrade-to-null failure mode. DB-free, fake fetch.
 *
 * Run: npx tsx --test src/lib/photos/local-vision-client.test.ts
 */

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import {
  resolveLocalVisionConfig,
  normalizeLocalVisionResponse,
  analyzeWithLocalVision,
  type LocalVisionDeps,
} from './local-vision-client';

// ─── resolveLocalVisionConfig ───────────────────────────────────────────────

test('config: org localVisionBaseUrl wins, trailing slash stripped, token from env', () => {
  const cfg = resolveLocalVisionConfig(
    { localVisionBaseUrl: 'https://vision.example/' },
    { VISION_ANALYZE_BASE_URL: 'https://env.example', VISION_TOKEN: 'secret' } as NodeJS.ProcessEnv,
  );
  strictEqual(cfg?.baseUrl, 'https://vision.example');
  strictEqual(cfg?.token, 'secret');
});

test('config: falls back to VISION_ANALYZE_BASE_URL then NEXT_PUBLIC_VISION_BASE_URL', () => {
  strictEqual(
    resolveLocalVisionConfig({ localVisionBaseUrl: '' }, {
      VISION_ANALYZE_BASE_URL: 'https://tunnel.example',
    } as NodeJS.ProcessEnv)?.baseUrl,
    'https://tunnel.example',
  );
  strictEqual(
    resolveLocalVisionConfig(undefined, {
      NEXT_PUBLIC_VISION_BASE_URL: 'https://lan.example',
    } as NodeJS.ProcessEnv)?.baseUrl,
    'https://lan.example',
  );
});

test('config: null when no base url is configured anywhere', () => {
  strictEqual(resolveLocalVisionConfig(undefined, {} as NodeJS.ProcessEnv), null);
  strictEqual(resolveLocalVisionConfig({ localVisionBaseUrl: '' }, {} as NodeJS.ProcessEnv), null);
});

// ─── normalizeLocalVisionResponse ───────────────────────────────────────────

test('normalize: caps arrays, derives caption from labels when absent', () => {
  const meta = normalizeLocalVisionResponse({
    ocr_text: Array.from({ length: 30 }, (_, i) => `line${i}`),
    labels: Array.from({ length: 20 }, (_, i) => `label${i}`),
  });
  strictEqual(meta.ocr_text.length, 20);
  strictEqual(meta.labels.length, 12);
  strictEqual(meta.caption, 'label0, label1, label2');
});

test('normalize: explicit damage_detected flag is honored', () => {
  const meta = normalizeLocalVisionResponse({
    labels: ['headphones'],
    damage_detected: true,
    damage_notes: 'left cup cracked',
  });
  strictEqual(meta.damage_detected, true);
  strictEqual(meta.damage_notes, 'left cup cracked');
});

test('normalize: keyword scan of OCR/labels flags damage even when box did not', () => {
  const meta = normalizeLocalVisionResponse({
    ocr_text: ['BOSE QC35', 'box is dented and the corner is cracked'],
    labels: ['carton'],
  });
  strictEqual(meta.damage_detected, true);
  // notes derived from matched keywords in DAMAGE_KEYWORDS order (dent ⊂ dented, crack/cracked ⊂ cracked)
  deepStrictEqual(meta.damage_notes, 'dent, crack, cracked');
});

test('normalize: no damage → flag false, notes null', () => {
  const meta = normalizeLocalVisionResponse({ ocr_text: ['clean unit'], labels: ['speaker'] });
  strictEqual(meta.damage_detected, false);
  strictEqual(meta.damage_notes, null);
});

test('normalize: junk fields fall back safely', () => {
  const meta = normalizeLocalVisionResponse({
    ocr_text: 'not an array' as unknown as string[],
    labels: [123, 'ok', null] as unknown as string[],
  });
  deepStrictEqual(meta.ocr_text, []);
  deepStrictEqual(meta.labels, ['ok']);
  strictEqual(meta.caption, 'ok');
});

// ─── analyzeWithLocalVision (fetch contract) ────────────────────────────────

function fakeFetch(
  impl: (url: string, init: RequestInit) => Response | Promise<Response>,
): { deps: LocalVisionDeps; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const deps: LocalVisionDeps = {
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return impl(String(url), init ?? {});
    }) as unknown as typeof fetch,
  };
  return { deps, calls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('analyze: posts multipart to /analyze with the token header and maps the body', async () => {
  const { deps, calls } = fakeFetch(() =>
    jsonResponse({ ocr_text: ['SN 12345'], labels: ['BOSE-QC35'], caption: 'QC35 label' }),
  );
  const meta = await analyzeWithLocalVision(
    Buffer.from('jpeg-bytes'),
    { baseUrl: 'https://vision.example', token: 'secret' },
    'label.jpg',
    deps,
  );

  strictEqual(calls.length, 1);
  strictEqual(calls[0].url, 'https://vision.example/analyze');
  strictEqual(calls[0].init.method, 'POST');
  strictEqual((calls[0].init.headers as Record<string, string>)['x-vision-token'], 'secret');
  ok(calls[0].init.body instanceof FormData);
  deepStrictEqual(meta?.labels, ['BOSE-QC35']);
  strictEqual(meta?.caption, 'QC35 label');
});

test('analyze: no token header sent when the box has no token', async () => {
  const { deps, calls } = fakeFetch(() => jsonResponse({ labels: ['x'] }));
  await analyzeWithLocalVision(Buffer.from('x'), { baseUrl: 'https://v.example', token: '' }, 'p.jpg', deps);
  strictEqual('x-vision-token' in (calls[0].init.headers as Record<string, string>), false);
});

test('analyze: null when config is missing (no call made)', async () => {
  const { deps, calls } = fakeFetch(() => jsonResponse({}));
  strictEqual(await analyzeWithLocalVision(Buffer.from('x'), null, 'p.jpg', deps), null);
  strictEqual(calls.length, 0);
});

test('analyze: HTTP error degrades to null', async () => {
  const { deps } = fakeFetch(() => jsonResponse({ error: 'boom' }, 500));
  strictEqual(
    await analyzeWithLocalVision(Buffer.from('x'), { baseUrl: 'https://v.example', token: '' }, 'p.jpg', deps),
    null,
  );
});

test('analyze: network throw degrades to null (box down)', async () => {
  const { deps } = fakeFetch(() => {
    throw new Error('ECONNREFUSED');
  });
  strictEqual(
    await analyzeWithLocalVision(Buffer.from('x'), { baseUrl: 'https://v.example', token: '' }, 'p.jpg', deps),
    null,
  );
});

test('analyze: unparseable body degrades to null', async () => {
  const { deps } = fakeFetch(() => new Response('<html>not json</html>', { status: 200 }));
  strictEqual(
    await analyzeWithLocalVision(Buffer.from('x'), { baseUrl: 'https://v.example', token: '' }, 'p.jpg', deps),
    null,
  );
});
