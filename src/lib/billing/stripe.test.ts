/**
 * Stripe webhook signature verification.
 *
 * We re-implement the v1 signing scheme here (HMAC-SHA256 over
 * `<ts>.<rawBody>`) and check that our verifier accepts valid signatures
 * and rejects every flavor of bad one.
 */

import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { createHmac } from 'node:crypto';

import { verifyStripeSignature } from './stripe';

const SECRET = 'whsec_test_secret_for_unit_tests_only';

function sign(rawBody: string, secret: string = SECRET, ts: number = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
  return `t=${ts},v1=${v1}`;
}

test('accepts a fresh, correctly-signed payload', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.created' });
  const header = sign(body);
  strictEqual(
    verifyStripeSignature({ rawBody: body, signatureHeader: header, secret: SECRET }),
    true,
  );
});

test('rejects when signed with the wrong secret', () => {
  const body = JSON.stringify({ id: 'evt_2' });
  const header = sign(body, 'whsec_wrong_secret');
  strictEqual(
    verifyStripeSignature({ rawBody: body, signatureHeader: header, secret: SECRET }),
    false,
  );
});

test('rejects when the body has been tampered with', () => {
  const body = JSON.stringify({ id: 'evt_3', amount: 100 });
  const header = sign(body);
  const tampered = JSON.stringify({ id: 'evt_3', amount: 1000000 });
  strictEqual(
    verifyStripeSignature({ rawBody: tampered, signatureHeader: header, secret: SECRET }),
    false,
  );
});

test('rejects replays beyond the tolerance window', () => {
  const body = JSON.stringify({ id: 'evt_4' });
  const stale = Math.floor(Date.now() / 1000) - 600; // 10 min old
  const header = sign(body, SECRET, stale);
  strictEqual(
    verifyStripeSignature({
      rawBody: body, signatureHeader: header, secret: SECRET, toleranceSec: 300,
    }),
    false,
  );
});

test('rejects missing or malformed header', () => {
  const body = '{}';
  strictEqual(verifyStripeSignature({ rawBody: body, signatureHeader: null, secret: SECRET }), false);
  strictEqual(verifyStripeSignature({ rawBody: body, signatureHeader: '', secret: SECRET }), false);
  strictEqual(verifyStripeSignature({ rawBody: body, signatureHeader: 'garbage', secret: SECRET }), false);
  strictEqual(verifyStripeSignature({ rawBody: body, signatureHeader: 't=abc,v1=def', secret: SECRET }), false);
});

test('rejects when secret is empty (refuse to verify without a key)', () => {
  const body = '{}';
  const header = sign(body, '');
  strictEqual(verifyStripeSignature({ rawBody: body, signatureHeader: header, secret: '' }), false);
});
