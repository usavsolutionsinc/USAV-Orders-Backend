import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCanonicalTracking,
  stripFedexConcatPrefix,
  normalizeTrackingNumber,
  last8FromStoredTracking,
} from './tracking-format';

// ─── The reconciliation invariant ─────────────────────────────────────────────
// A scanned GS1/"96" FedEx barcode and the pasted human number it represents
// must canonicalize to the SAME value — that is the whole point of the module.

test('FedEx GS1/"96" barcode collapses to the embedded 12-digit human number', () => {
  const scanned = '9632001960200651497200382141152045'; // 34-digit gun read
  const pasted = '382141152045'; // what lands in Zoho reference#
  assert.equal(extractCanonicalTracking(scanned), pasted);
  assert.equal(extractCanonicalTracking(pasted), pasted);
  // The reconciliation invariant: both sides converge.
  assert.equal(extractCanonicalTracking(scanned), extractCanonicalTracking(pasted));
});

test('the scanned-vs-pasted last-8 happens to agree here, but full equality is stronger', () => {
  const scanned = '9632001960200651497200382141152045';
  const pasted = '382141152045';
  // last-8 matched by luck (human number is the tail) — canonical makes it exact.
  assert.equal(last8FromStoredTracking(scanned), last8FromStoredTracking(pasted));
  assert.equal(extractCanonicalTracking(scanned).length, 12);
});

// ─── Conservative: never corrupt an already-human-readable value ──────────────

test('plain 12-digit FedEx Express number is returned unchanged', () => {
  assert.equal(extractCanonicalTracking('382141152045'), '382141152045');
});

test('UPS 1Z label is left intact (not a long pure-digit barcode)', () => {
  assert.equal(extractCanonicalTracking('1Z999AA10123456784'), '1Z999AA10123456784');
});

test('USPS IMpb routing prefix still stripped (existing behavior preserved)', () => {
  const impb = '420902109405511899223197428265'; // 420 + ZIP + 9-prefixed tracking
  // Whatever normalizeTrackingNumber yields, extractCanonicalTracking must not
  // further mangle a USPS number into a FedEx tail.
  const viaNormalize = normalizeTrackingNumber(impb);
  assert.equal(extractCanonicalTracking(impb), viaNormalize);
  assert.ok(!viaNormalize.startsWith('420'));
});

test('a short non-FedEx digit string is untouched (no false FedEx tail)', () => {
  assert.equal(stripFedexConcatPrefix('12345'), '12345');
});

test('a long barcode with no FedEx-valid tail falls back to the cleaned full string', () => {
  // 20 digits that do not end in a valid FedEx Express/Ground number.
  const odd = '11111111111111111111';
  assert.equal(stripFedexConcatPrefix(odd), odd);
});

test('punctuation/spacing in a pasted number is normalized away before matching', () => {
  assert.equal(extractCanonicalTracking('3821 4115 2045'), '382141152045');
  assert.equal(extractCanonicalTracking('382-141-152-045'), '382141152045');
});
