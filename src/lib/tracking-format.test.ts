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

// ─── §3.1 cross-carrier hardening — never truncate a USPS number ──────────────
// The earlier (unsafe) strip guessed by trailing pattern: a valid 22-digit USPS
// IMpb number routinely ends in a 12-digit run matching FedEx Express
// `[39]\d{11}`, so it got folded onto a FedEx tail — which would have merged
// ~500 distinct USPS shipments. The hardened strip anchors on the 96-prefixed
// GS1 envelope, so every 92/93/94/95-prefixed USPS number passes through whole.

test('USPS 22-digit number whose tail looks like FedEx Express is left WHOLE (plan example)', () => {
  // The literal regression from the plan: trailing 12 = 314810260579 → [39]\d{11}.
  const usps = '9235990407314810260579';
  assert.equal(stripFedexConcatPrefix(usps), usps);
  assert.equal(extractCanonicalTracking(usps), usps);
});

test('USPS number ending in a FedEx-Express-looking 9-prefixed run is left WHOLE', () => {
  const usps = '9405998877912345678901'; // trailing 12 = 912345678901 → [39]\d{11}
  assert.equal(stripFedexConcatPrefix(usps), usps);
  assert.equal(extractCanonicalTracking(usps), usps);
});

test('USPS number ending in a FedEx-Ground-looking 96-prefixed run is left WHOLE', () => {
  const usps = '94001961234567890123'; // trailing 15 = 961234567890123 → 96\d{13}
  assert.equal(stripFedexConcatPrefix(usps), usps);
  assert.equal(extractCanonicalTracking(usps), usps);
});

// ─── §3.1 cross-carrier hardening — leave already-human numbers untouched ─────

test('a real 15-digit FedEx Ground number is NOT truncated to its trailing 12', () => {
  const ground = '961234567890123'; // valid 96-prefixed Ground, already human-readable
  assert.equal(stripFedexConcatPrefix(ground), ground);
  assert.equal(extractCanonicalTracking(ground), ground);
});

test('a plain 12-digit FedEx Express number passes through unchanged', () => {
  assert.equal(stripFedexConcatPrefix('382141152045'), '382141152045');
});

test('a UPS 1Z label is never mistaken for a FedEx GS1 envelope', () => {
  assert.equal(stripFedexConcatPrefix('1Z999AA10123456784'), '1Z999AA10123456784');
  assert.equal(extractCanonicalTracking('1Z999AA10123456784'), '1Z999AA10123456784');
});

test('only the 96-prefixed GS1-34 FedEx envelope collapses to its human number', () => {
  const scanned = '9632001960200651497200382141152045'; // 34-digit, 96-prefixed
  assert.equal(stripFedexConcatPrefix(scanned), '382141152045');
});
