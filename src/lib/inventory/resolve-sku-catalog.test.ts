/**
 * Guards for the §6 single guarded pairing function (sku-reconciliation plan).
 *
 * The strip must fire ONLY on a pure NNNN-N counter suffix, never on -P-N part
 * indices or non-numeric (color/condition) suffixes — the two SKU schemes
 * collide, so a broad strip would mis-pair distinct products. Exact/explicit
 * matches must still win before any strip, and an unresolved SKU must fall
 * through to the queue (best-effort) while still returning null.
 *
 * DB-free: the catalog lookup and the queue are injected fakes.
 */

import { test, before } from 'node:test';
import { equal, deepEqual } from 'node:assert';
import type { ResolvedSkuCatalog, ResolveSkuCatalogDeps } from './resolve-sku-catalog';

// The module transitively imports `@/lib/neon-client`, which throws at load when
// NODE_ENV !== 'test' and DATABASE_URL is unset (the CI unit-test step runs with
// neither). Set the flag, then dynamically import in a `before` hook so the
// module evaluates after it — keeping the test DB-free without env wiring.
// (Top-level await isn't available in tsx's CJS output, hence the hook.)
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
let resolveSkuCatalogRow: typeof import('./resolve-sku-catalog').resolveSkuCatalogRow;
let strippableVariantBase: typeof import('./resolve-sku-catalog').strippableVariantBase;
before(async () => {
  ({ resolveSkuCatalogRow, strippableVariantBase } = await import('./resolve-sku-catalog'));
});

function row(id: number, sku: string): ResolvedSkuCatalog {
  return { id, sku, product_title: `Product ${sku}`, gtin: null };
}

/**
 * Build deps backed by a fixed catalog map. `lookup` resolves an explicit id or
 * a trimmed SKU string against the map; `queue` records every enqueued raw SKU.
 */
function fakes(catalog: Record<string, ResolvedSkuCatalog>, byId: Record<number, ResolvedSkuCatalog> = {}) {
  const queued: string[] = [];
  const lookupCalls: Array<{ sku: string; explicitId: number | null | undefined }> = [];
  const deps: ResolveSkuCatalogDeps = {
    async lookup(skuInput, explicitId) {
      lookupCalls.push({ sku: skuInput, explicitId });
      if (explicitId != null && Number.isFinite(explicitId) && explicitId > 0) {
        return byId[Math.floor(explicitId)] ?? null;
      }
      return catalog[String(skuInput ?? '').trim()] ?? null;
    },
    async queue(rawSku) {
      queued.push(rawSku);
    },
  };
  return { deps, queued, lookupCalls };
}

// ─── strippableVariantBase boundaries ────────────────────────────────────────

test('strippableVariantBase strips a pure NNNN-N counter suffix', () => {
  equal(strippableVariantBase('00010-2'), '00010');
  equal(strippableVariantBase('1234-5'), '1234');
  equal(strippableVariantBase('012880-14'), '012880');
});

test('strippableVariantBase never strips a protected -P-N part index', () => {
  equal(strippableVariantBase('00072-P-1'), null);
  equal(strippableVariantBase('00046-P-17'), null);
});

test('strippableVariantBase never strips a non-numeric (color/condition) suffix', () => {
  equal(strippableVariantBase('00010-B'), null);
  equal(strippableVariantBase('00010-WH'), null);
  equal(strippableVariantBase('00010-SW'), null);
});

test('strippableVariantBase ignores bare bases and sub-4-digit bases', () => {
  equal(strippableVariantBase('00010'), null); // no dash
  equal(strippableVariantBase('123-5'), null); // base < 4 digits
  equal(strippableVariantBase(''), null);
  equal(strippableVariantBase('   '), null);
});

// ─── resolveSkuCatalogRow: exact / explicit win before any strip ─────────────

test('exact match wins — never strips, never queues', async () => {
  const { deps, queued } = fakes({ '00010-2': row(7, '00010-2') });
  const res = await resolveSkuCatalogRow('00010-2', null, undefined, deps);
  equal(res?.id, 7);
  deepEqual(queued, []);
});

test('explicit id wins — never strips, never queues', async () => {
  const { deps, queued, lookupCalls } = fakes({}, { 5: row(5, '00099') });
  const res = await resolveSkuCatalogRow('ignored-input', 5, undefined, deps);
  equal(res?.id, 5);
  equal(lookupCalls.length, 1, 'only the explicit-id lookup runs (short-circuit)');
  deepEqual(queued, []);
});

test('explicit id miss does NOT strip (explicit short-circuits the base chain)', async () => {
  // base "00010" exists, but an explicit id was supplied → no strip retry.
  const { deps, lookupCalls } = fakes({ '00010': row(1, '00010') }, {});
  const res = await resolveSkuCatalogRow('00010-2', 999, undefined, deps);
  equal(res, null);
  equal(lookupCalls.length, 1, 'only the explicit-id lookup runs');
});

// ─── resolveSkuCatalogRow: the guarded strip ─────────────────────────────────

test('strips NNNN-N to its base when the suffixed form misses but the base hits', async () => {
  const { deps, queued } = fakes({ '00010': row(1, '00010') });
  const res = await resolveSkuCatalogRow('00010-2', null, undefined, deps);
  equal(res?.id, 1, 'resolves via the stripped base');
  deepEqual(queued, [], 'a successful strip does not queue');
});

test('does NOT strip a -P-N part index — misses and queues the original', async () => {
  // base "00072" exists, but -P-1 is a distinct physical component: must NOT collapse.
  const { deps, queued } = fakes({ '00072': row(2, '00072') });
  const res = await resolveSkuCatalogRow('00072-P-1', null, undefined, deps);
  equal(res, null, 'never resolves a part index to its base');
  deepEqual(queued, ['00072-P-1'], 'unresolved → queued verbatim');
});

test('does NOT strip a non-numeric suffix — misses and queues the original', async () => {
  const { deps, queued } = fakes({ '00010': row(1, '00010') });
  const res = await resolveSkuCatalogRow('00010-B', null, undefined, deps);
  equal(res, null, 'color/condition variant never collapses to the base');
  deepEqual(queued, ['00010-B']);
});

// ─── resolveSkuCatalogRow: queue-on-miss ─────────────────────────────────────

test('total miss queues the raw SKU and returns null', async () => {
  const { deps, queued } = fakes({});
  const res = await resolveSkuCatalogRow('  99999  ', null, undefined, deps);
  equal(res, null);
  deepEqual(queued, ['99999'], 'queues the trimmed raw SKU');
});

test('empty input neither resolves nor queues', async () => {
  const { deps, queued } = fakes({});
  const res = await resolveSkuCatalogRow('   ', null, undefined, deps);
  equal(res, null);
  deepEqual(queued, []);
});
