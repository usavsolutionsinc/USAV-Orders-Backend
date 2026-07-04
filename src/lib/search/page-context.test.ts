/**
 * DB-free unit tests for pageContextToEntityTypes (Phase 2a).
 * Run: npx tsx --test src/lib/search/page-context.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageContextToEntityTypes } from './page-context';

test('maps known surfaces to their entity scope', () => {
  assert.deepEqual(pageContextToEntityTypes('/dashboard'), ['ORDER']);
  assert.deepEqual(pageContextToEntityTypes('/receiving'), ['RECEIVING']);
  assert.deepEqual(pageContextToEntityTypes('/products'), ['SKU']);
  assert.deepEqual(pageContextToEntityTypes('/inventory/units'), ['SERIAL_UNIT', 'SKU']);
  assert.deepEqual(pageContextToEntityTypes('/repair'), ['REPAIR']);
  assert.deepEqual(pageContextToEntityTypes('/fba'), ['FBA_SHIPMENT']);
  assert.deepEqual(pageContextToEntityTypes('/tech'), ['SERIAL_UNIT']);
});

test('subpaths and query strings resolve by first segment', () => {
  assert.deepEqual(pageContextToEntityTypes('/receiving?mode=receive&openReceivingId=3'), ['RECEIVING']);
  assert.deepEqual(pageContextToEntityTypes('/products?view=qc&skuId=11'), ['SKU']);
  assert.deepEqual(pageContextToEntityTypes('/inventory/bins'), ['SERIAL_UNIT', 'SKU']);
});

test('full URLs are tolerated (pathname extracted)', () => {
  assert.deepEqual(pageContextToEntityTypes('https://app.example.com/repair?tab=active'), ['REPAIR']);
});

test('unknown / global / blank surfaces return undefined (no boost)', () => {
  assert.equal(pageContextToEntityTypes('/operations'), undefined);
  assert.equal(pageContextToEntityTypes('/studio'), undefined);
  assert.equal(pageContextToEntityTypes('/ai-chat'), undefined);
  assert.equal(pageContextToEntityTypes('/'), undefined);
  assert.equal(pageContextToEntityTypes(''), undefined);
  assert.equal(pageContextToEntityTypes(null), undefined);
  assert.equal(pageContextToEntityTypes(undefined), undefined);
});

test('case-insensitive on the segment', () => {
  assert.deepEqual(pageContextToEntityTypes('/Receiving'), ['RECEIVING']);
});
