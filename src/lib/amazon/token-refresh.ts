/**
 * Amazon LWA (Login with Amazon) token exchange.
 *
 * SP-API auth is LWA-only (no AWS IAM/SigV4 since 2023-10-02). Two flows:
 *   - exchangeAuthCode()   : OAuth authorization-code → refresh token (Connect screen)
 *   - exchangeRefreshToken(): refresh token → 1-hour access token (every request)
 *
 * Token storage mirrors the eBay helper: encrypt at rest when INTEGRATION_KMS_KEY
 * is configured, otherwise store plaintext so the integration keeps working until
 * the key is provisioned. readAmazonToken() reads either form transparently.
 */
import { normalizeEnvValue } from '@/lib/env-utils';
import {
  decryptIntegrationPayload,
  encryptIntegrationPayload,
  isIntegrationKmsConfigured,
} from '@/lib/integrations/crypto';
import { LWA_TOKEN_URL } from './constants';

/**
 * Plaintext LWA tokens are pipe-delimited (access: "Atza|…", refresh: "Atzr|…").
 * The AES-GCM envelope is base64, whose alphabet never contains "|", so the
 * pipe is an unambiguous "this is a plaintext LWA token" marker.
 */
function isPlaintextLwaToken(value: string): boolean {
  return value.includes('|');
}

/** Read a stored LWA token that may be plaintext or an encrypted envelope. */
export function readAmazonToken(stored: string | null | undefined): string {
  const raw = String(stored ?? '').trim();
  if (!raw) throw new Error('Amazon token is empty');
  if (isPlaintextLwaToken(raw)) return raw;
  try {
    return decryptIntegrationPayload<string>(raw);
  } catch (err: any) {
    throw new Error(`Amazon token is neither a plaintext token nor decryptable: ${err?.message || err}`);
  }
}

/** Encode an LWA token for storage (encrypt when KMS is configured). */
export function writeAmazonToken(plaintext: string): string {
  return isIntegrationKmsConfigured() ? encryptIntegrationPayload(plaintext) : plaintext;
}

interface LwaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

async function postLwa(params: Record<string, string>): Promise<LwaTokenResponse> {
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LWA token request failed: HTTP ${res.status} ${text}`);
  }
  return (await res.json()) as LwaTokenResponse;
}

/**
 * Exchange the OAuth authorization-code (spapi_oauth_code) for a refresh token.
 * Used once per connection on the Connect screen callback.
 */
export async function exchangeAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const cid = normalizeEnvValue(clientId), secret = normalizeEnvValue(clientSecret);
  if (!cid || !secret) throw new Error('Missing LWA client_id/client_secret');
  if (!code) throw new Error('Missing authorization code');
  const data = await postLwa({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cid,
    client_secret: secret,
  });
  if (!data.refresh_token) throw new Error('LWA did not return a refresh_token');
  return { refreshToken: data.refresh_token, accessToken: data.access_token, expiresIn: data.expires_in || 3600 };
}

/** Exchange a stored refresh token for a fresh 1-hour access token. */
export async function exchangeRefreshToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const cid = normalizeEnvValue(clientId), secret = normalizeEnvValue(clientSecret),
        rt = normalizeEnvValue(refreshToken);
  if (!cid || !secret || !rt) {
    throw new Error('Missing Amazon LWA credentials (client_id/client_secret/refresh_token)');
  }
  const data = await postLwa({
    grant_type: 'refresh_token',
    refresh_token: rt,
    client_id: cid,
    client_secret: secret,
  });
  return { accessToken: data.access_token, expiresIn: data.expires_in || 3600 };
}
