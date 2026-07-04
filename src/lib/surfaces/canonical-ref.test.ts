/**
 * Canonical-ref grammar tests — DB-free (pure module).
 * Run: npm run test:surfaces
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAxisRef, formatEntityRef, isCanonicalRef, parseCanonicalRef } from './canonical-ref';

test('entity form round-trips', () => {
  const ref = formatEntityRef('serial_units', 9041);
  assert.equal(ref, 'serial_units:entity:9041');
  const parsed = parseCanonicalRef(ref);
  assert.deepEqual(parsed, {
    table: 'serial_units',
    axis: null,
    value: null,
    entityId: '9041',
    entityIdNumber: 9041,
  });
});

test('axis form round-trips (the plan §-1 Q11 example)', () => {
  const ref = formatAxisRef('feed_memberships', 'feed_key', 'receiving_triage', 123);
  assert.equal(ref, 'feed_memberships:feed_key:receiving_triage:entity:123');
  const parsed = parseCanonicalRef(ref);
  assert.deepEqual(parsed, {
    table: 'feed_memberships',
    axis: 'feed_key',
    value: 'receiving_triage',
    entityId: '123',
    entityIdNumber: 123,
  });
});

test('text ids (uuid-keyed rows) parse with entityIdNumber null', () => {
  const ref = formatEntityRef('workflow_nodes', 'n-8f14e45f-ceea-467f-a0d6-1c4c1f5b2a3d');
  const parsed = parseCanonicalRef(ref);
  assert.ok(parsed);
  assert.equal(parsed.entityId, 'n-8f14e45f-ceea-467f-a0d6-1c4c1f5b2a3d');
  assert.equal(parsed.entityIdNumber, null);
});

test('format validates segments', () => {
  assert.throws(() => formatEntityRef('Bad Table', 1));
  assert.throws(() => formatEntityRef('orders', 'has:colon'));
  assert.throws(() => formatAxisRef('feed_memberships', 'feed key', 'x', 1));
  assert.throws(() => formatAxisRef('feed_memberships', 'feed_key', 'UPPER CASE', 1));
});

test('format rejects numeric garbage ids (NaN / negative / fractional / zero)', () => {
  assert.throws(() => formatEntityRef('serial_units', Number('not-a-number')));
  assert.throws(() => formatEntityRef('serial_units', -5));
  assert.throws(() => formatEntityRef('serial_units', 1.5));
  assert.throws(() => formatEntityRef('serial_units', 0));
  assert.throws(() => formatAxisRef('feed_memberships', 'feed_key', 'x', Number.NaN));
});

test("axis segment may not be the reserved word 'entity' (format + parse)", () => {
  assert.throws(() => formatAxisRef('foo', 'entity', 'bar', 1));
  assert.equal(parseCanonicalRef('foo:entity:bar:entity:1'), null);
});

test('parse rejects malformed refs (never throws)', () => {
  const bad = [
    null,
    undefined,
    42,
    '',
    'orders',
    'orders:entity',
    'orders:entity:',
    'orders:row:5',
    'orders:entity:5:extra',
    'feed_memberships:feed_key:receiving_triage:5', // missing entity marker
    'feed_memberships:feed_key:receiving_triage:row:5',
    'a:'.repeat(300) + 'entity:1', // oversized
  ];
  for (const ref of bad) {
    assert.equal(parseCanonicalRef(ref), null, `expected null for ${String(ref)}`);
    assert.equal(isCanonicalRef(ref), false);
  }
});

test('zero / negative / non-integer ids yield entityIdNumber null but still parse as text ids', () => {
  const zero = parseCanonicalRef('orders:entity:0');
  assert.ok(zero);
  assert.equal(zero.entityIdNumber, null);
  const alpha = parseCanonicalRef('orders:entity:abc');
  assert.ok(alpha);
  assert.equal(alpha.entityIdNumber, null);
});
