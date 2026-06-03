/**
 * Unit tests for the USPS subscription + webhook-parse layer.
 * Pure functions only — no network. Run: `npm run test:shipping-usps`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSubscriptionRequestBody } from './usps-subscription';
import { parseUSPSTrackingPayload } from './usps';

test('buildSubscriptionRequestBody includes tracking number + callback url', () => {
  const body = buildSubscriptionRequestBody('9400100000000000000000', 'https://x.test/api/webhooks/usps', 'sek');
  assert.equal(body.trackingNumber, '9400100000000000000000');
  assert.equal(body.callbackUrl, 'https://x.test/api/webhooks/usps');
  assert.equal(body.sharedSecret, 'sek');
});

test('buildSubscriptionRequestBody omits sharedSecret when empty', () => {
  const body = buildSubscriptionRequestBody('9400100000000000000000', 'https://x.test/cb', '');
  assert.equal('sharedSecret' in body, false);
});

test('parseUSPSTrackingPayload parses a full tracking-response shape (webhook follows it)', () => {
  const payload = {
    trackingNumber: '9400100000000000000000',
    statusCategory: 'In Transit',
    trackSummary: {
      event: 'Arrived at USPS Regional Facility',
      eventCode: '10',
      eventCity: 'ATLANTA',
      eventState: 'GA',
      eventDate: 'March 9, 2025',
      eventTime: '8:00 am',
    },
    trackDetail: [
      { event: 'Accepted', eventCode: '01', eventCity: 'MIAMI', eventState: 'FL', eventDate: 'March 8, 2025', eventTime: '2:00 pm' },
    ],
  };
  const result = parseUSPSTrackingPayload(payload);
  assert.ok(result);
  assert.equal(result!.carrier, 'USPS');
  assert.equal(result!.trackingNumberNormalized, '9400100000000000000000');
  assert.equal(result!.events.length, 2);
  // Summary is the latest event and carries through to the summary fields.
  assert.equal(result!.latestStatusCode, '10');
  assert.equal(result!.events[0].city, 'ATLANTA');
});

test('parseUSPSTrackingPayload tolerates a single bare event notification', () => {
  const payload = {
    trackingNumber: '9400100000000000000000',
    event: 'Delivered',
    eventCode: '01',
    eventCity: 'TAMPA',
    eventState: 'FL',
    eventDate: 'March 10, 2025',
    eventTime: '11:00 am',
  };
  const result = parseUSPSTrackingPayload(payload);
  assert.ok(result);
  assert.equal(result!.events.length, 1);
  assert.equal(result!.events[0].externalStatusDescription, 'Delivered');
});

test('parseUSPSTrackingPayload uses normalizedOverride when payload omits the number', () => {
  const result = parseUSPSTrackingPayload({ trackSummary: { event: 'In Transit', eventCode: '10' } }, '9400111111111111111111');
  assert.ok(result);
  assert.equal(result!.trackingNumberNormalized, '9400111111111111111111');
});

test('parseUSPSTrackingPayload returns null with no resolvable tracking number', () => {
  assert.equal(parseUSPSTrackingPayload({ trackSummary: { event: 'In Transit' } }), null);
});
