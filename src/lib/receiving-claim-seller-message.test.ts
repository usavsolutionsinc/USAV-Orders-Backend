import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaimSellerMessageRefs } from './receiving-claim-seller-message';

test('normalizeClaimSellerMessageRefs maps unfound placeholder line to carton scope', () => {
  assert.deepEqual(
    normalizeClaimSellerMessageRefs({ receivingId: 6936, lineId: -6936 }),
    { receivingId: 6936, lineId: null },
  );
});

test('normalizeClaimSellerMessageRefs keeps real receiving line ids', () => {
  assert.deepEqual(
    normalizeClaimSellerMessageRefs({ receivingId: 100, lineId: 42 }),
    { receivingId: 100, lineId: 42 },
  );
});
