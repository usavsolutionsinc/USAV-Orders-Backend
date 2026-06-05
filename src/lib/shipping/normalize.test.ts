/**
 * Unit tests for carrier status normalization — the delivered text-fallbacks
 * (Phase A3) that keep DELIVERED detection carrier-agnostic. Pure functions,
 * no network. Run: `npm run test:shipping-status`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  looksDelivered,
  normalizeUPSStatus,
  normalizeUSPSStatus,
  normalizeFedExStatus,
} from './normalize';

test('looksDelivered catches delivered phrasings without the literal word', () => {
  assert.equal(looksDelivered('Delivered'), true);
  assert.equal(looksDelivered('DELIVERED, Front Desk/Reception'), true);
  assert.equal(looksDelivered('Left at front door'), true);
  assert.equal(looksDelivered('Left with individual'), true);
  assert.equal(looksDelivered('Left in mailbox'), true);
  assert.equal(looksDelivered('Signed for by: J SMITH'), true);
  assert.equal(looksDelivered('Picked up by customer'), true);
});

test('looksDelivered does not false-positive on in-transit / origin scans', () => {
  assert.equal(looksDelivered('In transit'), false);
  assert.equal(looksDelivered('Out for delivery'), false);
  assert.equal(looksDelivered('Picked up'), false);          // origin pickup, not delivery
  assert.equal(looksDelivered('Arrived at facility'), false);
  assert.equal(looksDelivered('Shipment information sent to FedEx'), false);
  assert.equal(looksDelivered(null), false);
  assert.equal(looksDelivered(''), false);
});

test('UPS status code D and text fallbacks map to DELIVERED', () => {
  assert.equal(normalizeUPSStatus('D'), 'DELIVERED');
  assert.equal(normalizeUPSStatus(null, null, 'Left at front porch'), 'DELIVERED');
  assert.equal(normalizeUPSStatus(null, null, 'Delivered'), 'DELIVERED');
  // Unknown code falls through to text.
  assert.equal(normalizeUPSStatus('ZZ', null, 'In Transit'), 'IN_TRANSIT');
});

test('USPS category and text fallbacks map to DELIVERED', () => {
  assert.equal(normalizeUSPSStatus('DELIVERED'), 'DELIVERED');
  assert.equal(normalizeUSPSStatus('Delivered'), 'DELIVERED');
  assert.equal(normalizeUSPSStatus(null, 'Left with Individual'), 'DELIVERED');
  assert.equal(normalizeUSPSStatus(null, 'Delivered, In/At Mailbox'), 'DELIVERED');
});

test('FedEx event types DL/DT and text fallbacks map to DELIVERED', () => {
  assert.equal(normalizeFedExStatus('DL'), 'DELIVERED');
  assert.equal(normalizeFedExStatus('DT'), 'DELIVERED');
  assert.equal(normalizeFedExStatus(null, 'Left at front door'), 'DELIVERED');
  assert.equal(normalizeFedExStatus('ZZ', 'Delivered'), 'DELIVERED');
});

test('non-delivered statuses are unaffected by the delivered fallback', () => {
  assert.equal(normalizeFedExStatus('OD'), 'OUT_FOR_DELIVERY');
  assert.equal(normalizeUPSStatus('I'), 'IN_TRANSIT');
  assert.equal(normalizeUSPSStatus('OUT_FOR_DELIVERY'), 'OUT_FOR_DELIVERY');
});
