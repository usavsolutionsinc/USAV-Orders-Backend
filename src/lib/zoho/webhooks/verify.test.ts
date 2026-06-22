import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyZohoWebhookSignature } from './verify';

const HEADER = 'x-zoho-webhook-signature';

function sign(body: string, secret: string, encoding: 'hex' | 'base64' = 'hex'): string {
  return createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest(encoding);
}

function headersWith(sig: string): Headers {
  return new Headers({ [HEADER]: sig });
}

test('per-org secret: a correctly signed body verifies', () => {
  const body = '{"event_type":"purchaseorder.created","data":{}}';
  const secret = 'org-a-secret';
  const res = verifyZohoWebhookSignature(body, headersWith(sign(body, secret)), { secret });
  assert.equal(res.ok, true);
});

test('MULTI-TENANT ISOLATION: a body signed with org A secret is rejected under org B secret', () => {
  const body = '{"event_type":"purchaseorder.created","data":{}}';
  const sigFromA = sign(body, 'org-a-secret');
  // Verifier uses org B's secret → must NOT accept org A's signature.
  const res = verifyZohoWebhookSignature(body, headersWith(sigFromA), { secret: 'org-b-secret' });
  assert.equal(res.ok, false);
});

test('tampered body fails even with the right secret', () => {
  const secret = 'org-a-secret';
  const sig = sign('{"amount":1}', secret);
  const res = verifyZohoWebhookSignature('{"amount":9999}', headersWith(sig), { secret });
  assert.equal(res.ok, false);
});

test('falls back to ZOHO_WEBHOOK_SECRET when no per-org secret supplied', () => {
  const prev = process.env.ZOHO_WEBHOOK_SECRET;
  process.env.ZOHO_WEBHOOK_SECRET = 'global-legacy-secret';
  try {
    const body = '{"event_type":"purchaseorder.updated"}';
    const res = verifyZohoWebhookSignature(body, headersWith(sign(body, 'global-legacy-secret')));
    assert.equal(res.ok, true);
  } finally {
    process.env.ZOHO_WEBHOOK_SECRET = prev;
  }
});

test('missing signature header → fail (not throw)', () => {
  const res = verifyZohoWebhookSignature('{}', new Headers(), { secret: 's' });
  assert.equal(res.ok, false);
});

test('no secret available at all → fail closed', () => {
  const prev = process.env.ZOHO_WEBHOOK_SECRET;
  delete process.env.ZOHO_WEBHOOK_SECRET;
  try {
    const res = verifyZohoWebhookSignature('{}', headersWith('deadbeef'));
    assert.equal(res.ok, false);
  } finally {
    if (prev !== undefined) process.env.ZOHO_WEBHOOK_SECRET = prev;
  }
});
