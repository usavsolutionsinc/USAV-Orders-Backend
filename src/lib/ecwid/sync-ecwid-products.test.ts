/**
 * DB-free unit tests for the Ecwid product-mirror sync helpers
 * (reversibility plan 5.4 — deactivate pass guarded by fetch completeness).
 *
 * Run: npx tsx --test src/lib/ecwid/sync-ecwid-products.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEcwidProductItems,
  isEcwidFetchComplete,
  selectStaleEcwidRowIds,
} from './sync-ecwid-products';

// ── parseEcwidProductItems ──────────────────────────────────────────────────

test('parseEcwidProductItems maps well-formed items', () => {
  const out = parseEcwidProductItems([
    { id: 123, sku: ' AB-1 ', name: ' Widget ', thumbnailUrl: 'https://x/y.jpg' },
  ]);
  assert.deepEqual(out, [
    { ecwidProductId: '123', sku: 'AB-1', name: 'Widget', thumbnailUrl: 'https://x/y.jpg' },
  ]);
});

test('parseEcwidProductItems drops id-less and name-less rows', () => {
  const out = parseEcwidProductItems([
    { id: '', name: 'no id' },
    { id: 5, name: '   ' },
    { id: 6, name: 'kept' },
    null,
    'garbage',
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].ecwidProductId, '6');
});

test('parseEcwidProductItems normalizes blank sku and non-string thumbnail to null', () => {
  const out = parseEcwidProductItems([{ id: 9, sku: '  ', name: 'x', thumbnailUrl: 42 }]);
  assert.equal(out[0].sku, null);
  assert.equal(out[0].thumbnailUrl, null);
});

test('parseEcwidProductItems returns [] for a non-array payload', () => {
  assert.deepEqual(parseEcwidProductItems(undefined), []);
  assert.deepEqual(parseEcwidProductItems({ items: [] }), []);
});

// ── isEcwidFetchComplete ────────────────────────────────────────────────────

test('short page (fewer than limit) marks the fetch complete', () => {
  assert.equal(isEcwidFetchComplete(37, 100), true);
  assert.equal(isEcwidFetchComplete(0, 100), true);
});

test('full page is NOT complete — could be truncated at the page cap', () => {
  assert.equal(isEcwidFetchComplete(100, 100), false);
});

// ── selectStaleEcwidRowIds ──────────────────────────────────────────────────

test('rows absent from the fetch are selected for deactivation', () => {
  const stale = selectStaleEcwidRowIds(
    [
      { id: 1, platform_item_id: 'a' },
      { id: 2, platform_item_id: 'b' },
      { id: 3, platform_item_id: 'c' },
    ],
    ['a', 'c'],
  );
  assert.deepEqual(stale, [2]);
});

test('rows without a platform_item_id are never deactivated (cannot reconcile)', () => {
  const stale = selectStaleEcwidRowIds(
    [
      { id: 1, platform_item_id: null },
      { id: 2, platform_item_id: '' },
      { id: 3, platform_item_id: 'gone' },
    ],
    ['kept'],
  );
  assert.deepEqual(stale, [3]);
});

test('fetch covering every row selects nothing', () => {
  const stale = selectStaleEcwidRowIds(
    [
      { id: 1, platform_item_id: 'a' },
      { id: 2, platform_item_id: 'b' },
    ],
    ['b', 'a', 'extra-new-product'],
  );
  assert.deepEqual(stale, []);
});
