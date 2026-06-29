import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePartSku, isPartSku, normalizeBase } from './part-sku';

test('parses a bare part with no variant', () => {
  const p = parsePartSku('00002-P-1');
  assert.equal(p.isPart, true);
  assert.equal(p.base, '00002');
  assert.equal(p.stockIndex, 1);
  assert.equal(p.color, null);
  assert.equal(p.condition, null);
  assert.equal(p.logicalLabel, '00002 · Part');
});

test('parses color variant', () => {
  const p = parsePartSku('00004-P-1-BK');
  assert.equal(p.isPart, true);
  assert.equal(p.base, '00004');
  assert.equal(p.color, 'BK');
  assert.equal(p.colorLabel, 'Black');
  assert.equal(p.logicalLabel, '00004 · Part · Black');
});

test('parses color + condition variant', () => {
  const p = parsePartSku('00007-P-1-BK-N');
  assert.equal(p.color, 'BK');
  assert.equal(p.condition, 'N');
  assert.equal(p.conditionLabel, 'New');
  assert.equal(p.logicalLabel, '00007 · Part · Black · New');
});

test('stock index is a dedup counter — -1 and -3 collapse to the same logical part', () => {
  const a = parsePartSku('00007-P-1-BK');
  const b = parsePartSku('00007-P-3-BK');
  assert.notEqual(a.stockIndex, b.stockIndex); // different instances
  assert.equal(a.logicalKey, b.logicalKey); // same logical part
});

test('color and condition DO split logical parts', () => {
  const black = parsePartSku('00007-P-1-BK');
  const white = parsePartSku('00007-P-1-WH');
  const blackNew = parsePartSku('00007-P-1-BK-N');
  assert.notEqual(black.logicalKey, white.logicalKey);
  assert.notEqual(black.logicalKey, blackNew.logicalKey);
});

test('GR and GY both normalize to Gray and collapse together', () => {
  const gr = parsePartSku('00009-P-1-GR');
  const gy = parsePartSku('00009-P-2-GY');
  assert.equal(gr.colorLabel, 'Gray');
  assert.equal(gy.colorLabel, 'Gray');
  assert.equal(gr.logicalKey, gy.logicalKey);
});

test('condition can appear without a color', () => {
  const p = parsePartSku('00007-P-1-N');
  assert.equal(p.color, null);
  assert.equal(p.condition, 'N');
  assert.equal(p.logicalLabel, '00007 · Part · New');
});

test('unknown trailing token is captured, not mis-parsed, and keeps the part distinct', () => {
  const p = parsePartSku('00007-P-1-BK-ZZ');
  assert.equal(p.isPart, true);
  assert.equal(p.color, 'BK');
  assert.deepEqual(p.unknownTokens, ['ZZ']);
  // The mystery variant must NOT merge with a plain black part.
  assert.notEqual(p.logicalKey, parsePartSku('00007-P-1-BK').logicalKey);
});

test('non-part SKUs are rejected', () => {
  assert.equal(isPartSku('00007'), false); // whole unit, no -P
  assert.equal(isPartSku('00007-1-BK'), false); // no P flag
  assert.equal(isPartSku('ABC-P-1'), false); // non-numeric base
  assert.equal(isPartSku(''), false);
  assert.equal(isPartSku(null), false);
});

test('is leading/trailing whitespace and case tolerant', () => {
  const p = parsePartSku('  00007-p-1-bk-n  ');
  assert.equal(p.isPart, true);
  assert.equal(p.base, '00007');
  assert.equal(p.colorLabel, 'Black');
  assert.equal(p.conditionLabel, 'New');
});

test('normalizeBase is leading-zero tolerant', () => {
  assert.equal(normalizeBase('00007'), normalizeBase('7'));
  assert.equal(normalizeBase('00007'), '7');
});
