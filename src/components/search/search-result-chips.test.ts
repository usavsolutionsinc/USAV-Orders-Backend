import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderStatusTone, CHIP_TONE_CLASSES } from './search-result-chips';

test('orderStatusTone: known statuses map to their tone + dot class', () => {
  assert.equal(orderStatusTone('shipped').tone, 'blue');
  assert.equal(orderStatusTone('shipped').dot, 'bg-blue-500');
  assert.equal(orderStatusTone('delivered').tone, 'emerald');
  assert.equal(orderStatusTone('delivered').dot, 'bg-emerald-500');
  assert.equal(orderStatusTone('pending').tone, 'amber');
  assert.equal(orderStatusTone('cancelled').tone, 'rose');
  assert.equal(orderStatusTone('refunded').tone, 'rose');
  assert.equal(orderStatusTone('listed').tone, 'gray');
});

test('orderStatusTone: case-insensitive (DB vocabulary is mixed case)', () => {
  assert.equal(orderStatusTone('SHIPPED').tone, 'blue');
  assert.equal(orderStatusTone('Delivered').tone, 'emerald');
  assert.equal(orderStatusTone('  Cancelled  ').tone, 'rose'); // trims too
});

test('orderStatusTone: unknown status falls back to neutral gray (never a crash)', () => {
  const t = orderStatusTone('some_future_status');
  assert.equal(t.tone, 'gray');
  assert.equal(t.dot, 'bg-border-emphasis'); // NOT a hard crash, NOT a colored dot
});

test('orderStatusTone: null / undefined / empty → gray with a "No status" label', () => {
  for (const input of [null, undefined, '', '   ']) {
    const t = orderStatusTone(input);
    assert.equal(t.tone, 'gray');
    assert.equal(t.label, 'No status');
  }
});

test('orderStatusTone: label is title-cased from the raw value', () => {
  assert.equal(orderStatusTone('shipped').label, 'Shipped');
  assert.equal(orderStatusTone('DELIVERED').label, 'Delivered');
});

test('every tone maps to a defined chip class family (dot ↔ chip cannot diverge)', () => {
  for (const status of ['shipped', 'delivered', 'pending', 'cancelled', 'listed', 'unknownxyz']) {
    const { tone } = orderStatusTone(status);
    assert.ok(CHIP_TONE_CLASSES[tone], `chip class missing for tone ${tone}`);
  }
});
