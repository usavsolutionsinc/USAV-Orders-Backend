/**
 * Tests for the COLOR-axis decoder (sku-reconciliation plan, Step B).
 *
 * The decoder must:
 *   - decode ONLY the owner-confirmed suffixes (-B → Black, -W → White);
 *   - return null for the UNCONFIRMED suffixes (-N / -S / -SW) so they can never
 *     mis-tag data until the owner supplies a value;
 *   - never decode a -P-N part index or a non-color suffix;
 *   - extract the base correctly.
 *
 * Pure config-driven logic — fully DB-free, no env wiring.
 */

import { test } from 'node:test';
import { equal, deepEqual } from 'node:assert';
import {
  decodeSkuColorSuffix,
  skuColorVariant,
  SKU_COLOR_SUFFIX_MAP,
} from './sku-variant';

// ─── confirmed suffixes decode ───────────────────────────────────────────────

test('decodes -B to Black with the bare base', () => {
  deepEqual(decodeSkuColorSuffix('00046-B'), {
    base: '00046',
    colorCode: 'BLACK',
    colorLabel: 'Black',
  });
});

test('decodes -W to White with the bare base', () => {
  deepEqual(decodeSkuColorSuffix('01103-W'), {
    base: '01103',
    colorCode: 'WHITE',
    colorLabel: 'White',
  });
});

test('is case-insensitive on the suffix token', () => {
  equal(decodeSkuColorSuffix('00046-b')?.colorCode, 'BLACK');
  equal(decodeSkuColorSuffix('01103-w')?.colorCode, 'WHITE');
});

// ─── unconfirmed suffixes decode to null (never guess) ───────────────────────

test('returns null for the UNCONFIRMED -N / -S / -SW suffixes', () => {
  equal(decodeSkuColorSuffix('00010-N'), null);
  equal(decodeSkuColorSuffix('00010-S'), null);
  equal(decodeSkuColorSuffix('00010-SW'), null);
});

test('unconfirmed map entries are present but flagged confirmed:false with null value', () => {
  for (const token of ['N', 'S', 'SW']) {
    const entry = SKU_COLOR_SUFFIX_MAP[token];
    equal(entry.confirmed, false, `${token} must be unconfirmed`);
    equal(entry.code, null, `${token} must carry no color code`);
    equal(entry.label, null, `${token} must carry no color label`);
  }
});

// ─── never decode a part index or non-color suffix ───────────────────────────

test('never decodes a -P-N part index as a color', () => {
  equal(decodeSkuColorSuffix('00072-P-1'), null);
  equal(decodeSkuColorSuffix('00046-P-17'), null);
});

test('never decodes a numeric counter suffix as a color', () => {
  equal(decodeSkuColorSuffix('00010-2'), null);
  equal(decodeSkuColorSuffix('1234-5'), null);
});

test('returns null for an unknown letter suffix', () => {
  equal(decodeSkuColorSuffix('00010-GY'), null);
  equal(decodeSkuColorSuffix('00010-XYZ'), null);
});

// ─── base extraction / edge cases ────────────────────────────────────────────

test('returns null for a bare base, empty, or nullish input', () => {
  equal(decodeSkuColorSuffix('00046'), null); // no dash
  equal(decodeSkuColorSuffix(''), null);
  equal(decodeSkuColorSuffix('   '), null);
  equal(decodeSkuColorSuffix(null), null);
  equal(decodeSkuColorSuffix(undefined), null);
});

test('trims surrounding whitespace before decoding', () => {
  deepEqual(decodeSkuColorSuffix('  00046-B  '), {
    base: '00046',
    colorCode: 'BLACK',
    colorLabel: 'Black',
  });
});

test('extracts a multi-segment base correctly (only the final color token strips)', () => {
  // A base that itself contains a dash: only the trailing color token is removed.
  const decoded = decodeSkuColorSuffix('00046-X1-B');
  deepEqual(decoded, { base: '00046-X1', colorCode: 'BLACK', colorLabel: 'Black' });
});

// ─── skuColorVariant thin wrapper ────────────────────────────────────────────

test('skuColorVariant returns just the color pair for a confirmed suffix', () => {
  deepEqual(skuColorVariant('00046-B'), { colorCode: 'BLACK', colorLabel: 'Black' });
});

test('skuColorVariant returns null for unconfirmed / non-color / bare SKUs', () => {
  equal(skuColorVariant('00010-N'), null);
  equal(skuColorVariant('00072-P-1'), null);
  equal(skuColorVariant('00046'), null);
});
