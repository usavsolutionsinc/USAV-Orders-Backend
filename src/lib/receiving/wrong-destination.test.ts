import test from 'node:test';
import assert from 'node:assert/strict';
import { isWrongDestination, normalizePostalCode } from './wrong-destination';

test('normalizePostalCode keeps ZIP5 digits', () => {
  assert.equal(normalizePostalCode('89502-1234'), '89502');
  assert.equal(normalizePostalCode('  89431  '), '89431');
  assert.equal(normalizePostalCode('abc'), '');
});

test('isWrongDestination requires both sides', () => {
  assert.equal(isWrongDestination('89502', null), false);
  assert.equal(isWrongDestination(null, '89502'), false);
  assert.equal(isWrongDestination('89502', '89502'), false);
  assert.equal(isWrongDestination('89502', '89431'), true);
  assert.equal(isWrongDestination('89502-9999', '89502'), false);
});
