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
  // Unbox + Triage graduated to first-class receiving surfaces; page-context
  // must recognize them as RECEIVING for AI-search boosting.
  assert.deepEqual(pageContextToEntityTypes('/unbox?openReceivingId=3'), ['RECEIVING']);
  assert.deepEqual(pageContextToEntityTypes('/triage?triview=unfound'), ['RECEIVING']);
  assert.deepEqual(pageContextToEntityTypes('/products?view=qc&skuId=11'), ['SKU']);
  assert.deepEqual(pageContextToEntityTypes('/inventory/bins'), ['SERIAL_UNIT', 'SKU']);
});

// Every graduated operator surface (operator-surfaces refactor Phases 7–9) must
// map to a boost scope so AI search reorders toward the surface the operator is
// standing on. Canonical routes + their legacy aliases both resolve.
test('graduated surface routes map to the right AI-search boost', () => {
  // Pack (Phase 7) — order fulfillment.
  assert.deepEqual(pageContextToEntityTypes('/pack'), ['ORDER']);
  assert.deepEqual(pageContextToEntityTypes('/packer'), ['ORDER']); // legacy alias
  // Test (Phase 8) — serial-unit verification.
  assert.deepEqual(pageContextToEntityTypes('/test?view=testing'), ['SERIAL_UNIT']);
  assert.deepEqual(pageContextToEntityTypes('/tech?view=testing'), ['SERIAL_UNIT']); // legacy alias
  // Pickup + History (Phase 9) — receiving family.
  assert.deepEqual(pageContextToEntityTypes('/pickup'), ['RECEIVING']);
  assert.deepEqual(pageContextToEntityTypes('/receiving/history?recvId=5'), ['RECEIVING']);
  assert.deepEqual(pageContextToEntityTypes('/incoming'), ['RECEIVING']);
  // Outbound stays a global/order surface — no dedicated boost (still resolves clean).
  assert.equal(pageContextToEntityTypes('/outbound'), undefined);
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
