import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWarranty,
  daysUntilExpiry,
  decideClockRecompute,
  isExpired,
  DEFAULT_WARRANTY_DAYS,
  DELIVERY_ESTIMATE_DAYS,
} from './clock';

test('delivered date present → start=delivered, expiry=+30d, basis=DELIVERED', () => {
  const delivered = new Date('2026-01-01T00:00:00.000Z');
  const r = computeWarranty({ deliveredAt: delivered });
  assert.equal(r.basis, 'DELIVERED');
  assert.equal(r.warrantyDays, DEFAULT_WARRANTY_DAYS);
  assert.equal(r.startsAt?.toISOString(), delivered.toISOString());
  assert.equal(r.expiresAt?.toISOString(), new Date('2026-01-31T00:00:00.000Z').toISOString());
});

test('no delivered → packed + 4d estimate, then +30d, basis=PACKED_PLUS_ESTIMATE', () => {
  const packed = new Date('2026-01-01T00:00:00.000Z');
  const r = computeWarranty({ packedScannedAt: packed });
  assert.equal(r.basis, 'PACKED_PLUS_ESTIMATE');
  // start = packed + 4 = Jan 5; expiry = +30 = Feb 4
  assert.equal(r.startsAt?.toISOString(), new Date('2026-01-05T00:00:00.000Z').toISOString());
  assert.equal(r.expiresAt?.toISOString(), new Date('2026-02-04T00:00:00.000Z').toISOString());
});

test('delivered wins even when packed is also present', () => {
  const delivered = new Date('2026-03-10T00:00:00.000Z');
  const packed = new Date('2026-03-01T00:00:00.000Z');
  const r = computeWarranty({ deliveredAt: delivered, packedScannedAt: packed });
  assert.equal(r.basis, 'DELIVERED');
  assert.equal(r.startsAt?.toISOString(), delivered.toISOString());
});

test('neither anchor → null window, basis null, but term still resolved', () => {
  const r = computeWarranty({});
  assert.equal(r.startsAt, null);
  assert.equal(r.expiresAt, null);
  assert.equal(r.basis, null);
  assert.equal(r.warrantyDays, DEFAULT_WARRANTY_DAYS);
});

test('per-org term overrides the default', () => {
  const delivered = new Date('2026-01-01T00:00:00.000Z');
  const r = computeWarranty({ deliveredAt: delivered, warrantyDays: 90 });
  assert.equal(r.warrantyDays, 90);
  assert.equal(r.expiresAt?.toISOString(), new Date('2026-04-01T00:00:00.000Z').toISOString());
});

test('invalid / non-positive term falls back to the default', () => {
  const delivered = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(computeWarranty({ deliveredAt: delivered, warrantyDays: 0 }).warrantyDays, DEFAULT_WARRANTY_DAYS);
  assert.equal(computeWarranty({ deliveredAt: delivered, warrantyDays: -5 }).warrantyDays, DEFAULT_WARRANTY_DAYS);
});

test('accepts ISO strings as well as Date objects', () => {
  const r = computeWarranty({ deliveredAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(r.basis, 'DELIVERED');
  assert.equal(r.expiresAt?.toISOString(), new Date('2026-01-31T00:00:00.000Z').toISOString());
});

test('garbage date strings are ignored (treated as absent)', () => {
  const r = computeWarranty({ deliveredAt: 'not-a-date', packedScannedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(r.basis, 'PACKED_PLUS_ESTIMATE');
});

test('provisional→delivered recompute moves the window forward', () => {
  const packed = new Date('2026-01-01T00:00:00.000Z');
  const provisional = computeWarranty({ packedScannedAt: packed });
  // A real delivered date arrives later than the estimate.
  const delivered = new Date('2026-01-08T00:00:00.000Z');
  const final = computeWarranty({ deliveredAt: delivered, packedScannedAt: packed });
  assert.equal(provisional.basis, 'PACKED_PLUS_ESTIMATE');
  assert.equal(final.basis, 'DELIVERED');
  assert.ok((final.expiresAt as Date).getTime() > (provisional.expiresAt as Date).getTime());
});

test('estimate constant is 4 days', () => {
  assert.equal(DELIVERY_ESTIMATE_DAYS, 4);
});

test('daysUntilExpiry counts whole days and goes negative past expiry', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  assert.equal(daysUntilExpiry(new Date('2026-01-20T00:00:00.000Z'), now), 10);
  assert.equal(daysUntilExpiry(new Date('2026-01-05T00:00:00.000Z'), now), -5);
  assert.equal(daysUntilExpiry(null, now), null);
});

test('isExpired reflects the window relative to now', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');
  assert.equal(isExpired(new Date('2026-01-09T00:00:00.000Z'), now), true);
  assert.equal(isExpired(new Date('2026-01-11T00:00:00.000Z'), now), false);
  assert.equal(isExpired(null, now), false);
});

// ── decideClockRecompute (the sweep's "should I write?" gate) ────────────────

test('recompute: provisional → delivered writes and flags the flip', () => {
  const packed = new Date('2026-01-01T00:00:00.000Z');
  const provisional = computeWarranty({ packedScannedAt: packed }); // basis PACKED_PLUS_ESTIMATE
  const delivered = computeWarranty({ deliveredAt: new Date('2026-01-08T00:00:00.000Z') });
  const d = decideClockRecompute(
    { basis: 'PACKED_PLUS_ESTIMATE', expiresAt: provisional.expiresAt },
    delivered,
  );
  assert.equal(d.changed, true);
  assert.equal(d.flippedToDelivered, true);
});

test('recompute: unchanged provisional window is a no-op (no write)', () => {
  const next = computeWarranty({ packedScannedAt: new Date('2026-01-01T00:00:00.000Z') });
  const d = decideClockRecompute({ basis: 'PACKED_PLUS_ESTIMATE', expiresAt: next.expiresAt }, next);
  assert.equal(d.changed, false);
  assert.equal(d.flippedToDelivered, false);
});

test('recompute: null basis → delivered counts as a flip', () => {
  const delivered = computeWarranty({ deliveredAt: new Date('2026-02-01T00:00:00.000Z') });
  const d = decideClockRecompute({ basis: null, expiresAt: null }, delivered);
  assert.equal(d.changed, true);
  assert.equal(d.flippedToDelivered, true);
});

test('recompute: already delivered + same expiry is a no-op', () => {
  const delivered = computeWarranty({ deliveredAt: new Date('2026-03-01T00:00:00.000Z') });
  const d = decideClockRecompute({ basis: 'DELIVERED', expiresAt: delivered.expiresAt }, delivered);
  assert.equal(d.changed, false);
  assert.equal(d.flippedToDelivered, false);
});

test('recompute: provisional expiry shift (packed corrected) writes but is not a flip', () => {
  const before = computeWarranty({ packedScannedAt: new Date('2026-01-01T00:00:00.000Z') });
  const after = computeWarranty({ packedScannedAt: new Date('2026-01-03T00:00:00.000Z') });
  const d = decideClockRecompute({ basis: 'PACKED_PLUS_ESTIMATE', expiresAt: before.expiresAt }, after);
  assert.equal(d.changed, true);
  assert.equal(d.flippedToDelivered, false);
});
