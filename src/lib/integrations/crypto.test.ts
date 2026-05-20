/**
 * AES-256-GCM roundtrip for the integration vault.
 *
 * Runs with the existing `node --test --import tsx` harness — no extra deps.
 * Uses a fixed key here (deterministic test); production code reads it from
 * INTEGRATION_KMS_KEY.
 */

import { test, before } from 'node:test';
import { strictEqual, throws, ok } from 'node:assert';
import { randomBytes } from 'node:crypto';

// crypto.ts reads INTEGRATION_KMS_KEY lazily inside getKey(), so setting it
// from a `before()` hook is enough — the imports below don't trigger a
// key read.
import { encryptIntegrationPayload, decryptIntegrationPayload } from './crypto';

before(() => {
  process.env.INTEGRATION_KMS_KEY = randomBytes(32).toString('base64');
});

test('roundtrip preserves arbitrary JSON', () => {
  const original = {
    clientId: 'abc',
    refreshToken: 'rt_' + 'x'.repeat(80),
    nested: { a: 1, b: [1, 2, 3], c: 'tab\there\nthere' },
    bool: true,
    nullish: null,
  };
  const enc = encryptIntegrationPayload(original);
  const dec = decryptIntegrationPayload<typeof original>(enc);
  strictEqual(JSON.stringify(dec), JSON.stringify(original));
});

test('ciphertext differs between calls (random IV)', () => {
  const a = encryptIntegrationPayload({ x: 1 });
  const b = encryptIntegrationPayload({ x: 1 });
  ok(a !== b, 'two encryptions of the same plaintext must differ');
});

test('tampering with ciphertext throws on decrypt', () => {
  const enc = encryptIntegrationPayload({ x: 1 });
  // Flip the last char of the base64 so the underlying ciphertext mutates.
  const tampered = enc.slice(0, -1) + (enc.endsWith('A') ? 'B' : 'A');
  throws(() => decryptIntegrationPayload(tampered));
});

test('rejects malformed envelope', () => {
  throws(() => decryptIntegrationPayload(''));
  throws(() => decryptIntegrationPayload('not-base64!'));
});
