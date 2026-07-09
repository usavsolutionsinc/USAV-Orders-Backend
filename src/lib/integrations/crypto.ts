/**
 * AES-256-GCM payload encryption for organization_integrations.
 *
 * The key is read once at module load from INTEGRATION_KMS_KEY — a
 * base64-encoded 32-byte (256-bit) buffer. In production this should come
 * from a real KMS (AWS KMS, Google Cloud KMS, HashiCorp Vault) via your
 * deploy secret manager; we keep the storage shape KMS-compatible (one
 * symmetric key per environment) so swapping it later is a config change,
 * not a code change.
 *
 * Ciphertext format (base64):  <iv (12 bytes)><auth tag (16 bytes)><cipher>
 * Same envelope on both encrypt and decrypt — easy to grep through audit
 * logs and trivially identifiable in a hex dump.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_KMS_KEY;
  if (!raw) {
    throw new Error(
      'INTEGRATION_KMS_KEY is not set. Generate one with:  ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`INTEGRATION_KMS_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`);
  }
  cachedKey = key;
  return key;
}

/**
 * True when INTEGRATION_KMS_KEY is present and decodes to a valid 32-byte key,
 * i.e. encrypt/decrypt will work. Lets callers choose encrypted-at-rest when a
 * key is configured and fall back to plaintext when it isn't — without throwing.
 */
export function isIntegrationKmsConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Enforce encryption-at-rest in production. Call this on any code path that
 * would otherwise fall back to storing a secret as plaintext when no key is
 * configured (e.g. writeEbayToken). In production (Vercel `production`, or
 * NODE_ENV=production) a missing/invalid INTEGRATION_KMS_KEY throws; in
 * dev/preview it only warns so local work keeps going without the key.
 */
export function assertIntegrationKmsConfigured(context = 'integration credentials'): void {
  if (isIntegrationKmsConfigured()) return;
  const isProduction =
    process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error(
      `INTEGRATION_KMS_KEY must be configured in production to store ${context} ` +
        '(encryption-at-rest is required). Generate one with:  ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  console.warn(
    `[integrations] INTEGRATION_KMS_KEY not set — ${context} will be stored as plaintext (dev only).`,
  );
}

export function encryptIntegrationPayload(plaintext: unknown): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const json = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptIntegrationPayload<T = unknown>(envelope: string): T {
  const key = getKey();
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('encrypted payload is too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

/**
 * Store an integration payload. Encrypts when INTEGRATION_KMS_KEY is configured;
 * otherwise JSON-stringifies for local dev (mirrors writeEbayToken).
 */
export function serializeIntegrationPayload(plaintext: unknown): string {
  if (isIntegrationKmsConfigured()) return encryptIntegrationPayload(plaintext);
  assertIntegrationKmsConfigured('integration credentials');
  return JSON.stringify(plaintext);
}

/**
 * Read a stored integration payload — encrypted envelope or dev plaintext JSON.
 */
export function parseIntegrationPayload<T = unknown>(stored: string): T {
  const raw = stored.trim();
  if (!raw) throw new Error('integration payload is empty');
  if (raw.startsWith('{') || raw.startsWith('[')) {
    return JSON.parse(raw) as T;
  }
  return decryptIntegrationPayload<T>(raw);
}
