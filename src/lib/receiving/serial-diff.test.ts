import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSerials, pickClosestShippedSerial, normalizeSerialText } from './serial-diff';

test('normalizeSerialText trims + uppercases', () => {
  assert.equal(normalizeSerialText('  sn12ab '), 'SN12AB');
  assert.equal(normalizeSerialText(null), '');
});

test('identical serials → equal, zero diffs, all cells match', () => {
  const d = diffSerials('sn12345', 'SN12345');
  assert.equal(d.equal, true);
  assert.equal(d.diffCount, 0);
  assert.ok(d.received.every((c) => c.match));
  assert.ok(d.shipped.every((c) => c.match));
});

test('single mistyped char → one diff at the right position', () => {
  const d = diffSerials('SN12345678', 'SN12345679');
  assert.equal(d.equal, false);
  assert.equal(d.diffCount, 1);
  // last cell differs, the rest match
  assert.equal(d.received[d.received.length - 1].match, false);
  assert.equal(d.received.slice(0, -1).every((c) => c.match), true);
});

test('length overhang counts every extra char as a diff', () => {
  const d = diffSerials('SN123', 'SN12345');
  // positions 5,6 exist only on shipped → 2 diffs
  assert.equal(d.diffCount, 2);
  assert.equal(d.received.length, 5);
  assert.equal(d.shipped.length, 7);
  assert.equal(d.shipped[5].match, false);
  assert.equal(d.shipped[6].match, false);
});

test('empty received → all shipped cells are diffs, not equal', () => {
  const d = diffSerials('', 'SN12345');
  assert.equal(d.equal, false);
  assert.equal(d.diffCount, 7);
});

test('pickClosestShippedSerial picks the fewest-diff candidate', () => {
  const received = 'SN12345678';
  const shipped = ['ZZ99999999', 'SN12345679', 'SN00000000'];
  assert.equal(pickClosestShippedSerial(received, shipped), 'SN12345679');
});

test('pickClosestShippedSerial returns null on empty list, first on empty received', () => {
  assert.equal(pickClosestShippedSerial('SN1', []), null);
  assert.equal(pickClosestShippedSerial('', ['A', 'B']), 'A');
});
