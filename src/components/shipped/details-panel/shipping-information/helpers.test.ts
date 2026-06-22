import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { deriveShippingDisplayMeta } from './helpers';

function makeShipped(overrides: Record<string, unknown>): ShippedOrder {
  return { id: 1, ...overrides } as unknown as ShippedOrder;
}

test('deriveShippingDisplayMeta: prefers explicit name columns over staff lookup', () => {
  const meta = deriveShippingDisplayMeta(
    makeShipped({ packed_by_name: 'Alice', tester_name: 'Bob' }),
    [],
  );
  assert.equal(meta.packerNameDisplay, 'Alice');
  assert.equal(meta.techNameDisplay, 'Bob');
});

test('deriveShippingDisplayMeta: falls back to "Not specified" when no name resolves', () => {
  const meta = deriveShippingDisplayMeta(makeShipped({ packed_by: null, tested_by: null }), []);
  assert.equal(meta.packerNameDisplay, 'Not specified');
  assert.equal(meta.techNameDisplay, 'Not specified');
});

test('deriveShippingDisplayMeta: not scanned out → null name, N/A display', () => {
  const meta = deriveShippingDisplayMeta(makeShipped({}), []);
  assert.equal(meta.isScannedOut, false);
  assert.equal(meta.scannedOutByDisplay, null);
  assert.equal(meta.scannedOutDisplay, 'N/A');
});

test('deriveShippingDisplayMeta: scanned out (sentinel "1" is not a real timestamp)', () => {
  assert.equal(deriveShippingDisplayMeta(makeShipped({ ship_confirmed_at: '1' }), []).isScannedOut, false);
  assert.equal(
    deriveShippingDisplayMeta(makeShipped({ ship_confirmed_at: '2026-06-20T10:00:00Z', shipped_out_by_name: 'Dock' }), []).isScannedOut,
    true,
  );
});

test('deriveShippingDisplayMeta: packedAtSource prefers pack_activity_at, ignores "1" sentinel', () => {
  assert.equal(
    deriveShippingDisplayMeta(makeShipped({ pack_activity_at: '2026-06-20T10:00:00Z', packed_at: '2026-06-19T10:00:00Z' }), []).packedAtSource,
    '2026-06-20T10:00:00Z',
  );
  assert.equal(
    deriveShippingDisplayMeta(makeShipped({ pack_activity_at: '1', packed_at: '2026-06-19T10:00:00Z' }), []).packedAtSource,
    '2026-06-19T10:00:00Z',
  );
  assert.equal(deriveShippingDisplayMeta(makeShipped({ pack_activity_at: '1', packed_at: '1' }), []).packedAtSource, null);
});

test('deriveShippingDisplayMeta: copy text includes serials joined, "N/A" when empty', () => {
  const withSerials = deriveShippingDisplayMeta(makeShipped({ order_id: 'ORD-9' }), ['SN1', 'SN2']);
  assert.match(withSerials.returnsCopyText, /Order ID: ORD-9/);
  assert.match(withSerials.returnsCopyText, /Serials: SN1, SN2/);

  const noSerials = deriveShippingDisplayMeta(makeShipped({ order_id: '' }), []);
  assert.match(noSerials.returnsCopyText, /Order ID: N\/A/);
  assert.match(noSerials.returnsCopyText, /Serials: N\/A/);
});
