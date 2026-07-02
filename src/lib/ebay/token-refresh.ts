/**
 * Direct eBay OAuth2 Token Refresh
 * Converts the Python script to TypeScript for reliable token refreshing
 */
import { normalizeEnvValue } from '@/lib/env-utils';
import {
  assertIntegrationKmsConfigured,
  decryptIntegrationPayload,
  encryptIntegrationPayload,
  isIntegrationKmsConfigured,
} from '@/lib/integrations/crypto';
import {
  ebayScopeString,
  ebayTokenEndpoint,
  normalizeEbayEnvironment,
  type EbayEnvironment,
} from './oauth-config';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * eBay OAuth access/refresh tokens are JWT-like strings that always begin with
 * "v^". The AES-GCM envelope produced by encryptIntegrationPayload is base64,
 * whose alphabet never contains "^", so the prefix is an unambiguous marker for
 * "this is a plaintext eBay token" vs "this is an encrypted envelope".
 */
function isPlaintextEbayToken(value: string): boolean {
  return value.startsWith('v^');
}

/**
 * Read a stored eBay token that may be either a plaintext eBay token (written by
 * the get-*-ebay-tokens.js helper scripts) or an encrypted integration envelope
 * (written by /api/ebay/callback). Backward/forward compatible: returns plaintext
 * as-is and decrypts envelopes. Throws only when a value is neither.
 */
export function readEbayToken(stored: string | null | undefined): string {
  const raw = String(stored ?? '').trim();
  if (!raw) throw new Error('eBay token is empty');
  if (isPlaintextEbayToken(raw)) return raw;
  try {
    return decryptIntegrationPayload<string>(raw);
  } catch (err: any) {
    throw new Error(`eBay token is neither a plaintext token nor decryptable: ${err?.message || err}`);
  }
}

/**
 * Encode an eBay token for storage. Encrypts at rest when INTEGRATION_KMS_KEY is
 * configured; otherwise stores plaintext so the integration keeps working until
 * the key is provisioned. readEbayToken() reads either form transparently.
 */
export function writeEbayToken(plaintext: string): string {
  if (isIntegrationKmsConfigured()) return encryptIntegrationPayload(plaintext);
  // In production this throws (encryption-at-rest is required); in dev it warns
  // and falls back to plaintext so local work keeps going without a key.
  assertIntegrationKmsConfigured('eBay tokens');
  return plaintext;
}

/**
 * Refresh eBay access token using direct HTTP call to OAuth2 endpoint
 * This is more reliable than using the ebay-api library
 */
export async function refreshEbayAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  environment: EbayEnvironment | string = 'PRODUCTION',
  /**
   * Scope string to request on refresh. MUST match the set granted at consent —
   * a buyer account must pass its buyer scopes (ebayScopeStringForRole('buyer')),
   * or the refresh silently downgrades it to the seller set. Defaults to the
   * seller scopes for backward compatibility.
   */
  scopes: string = ebayScopeString(),
): Promise<{ accessToken: string; expiresIn: number }> {
  const normalizedClientId = normalizeEnvValue(clientId);
  const normalizedClientSecret = normalizeEnvValue(clientSecret);
  const normalizedRefreshToken = normalizeEnvValue(refreshToken);
  if (!normalizedClientId || !normalizedClientSecret || !normalizedRefreshToken) {
    throw new Error('Missing eBay OAuth credentials (client_id/client_secret/refresh_token)');
  }

  // 1. eBay OAuth2 token endpoint — environment-aware so SANDBOX tenants don't
  //    refresh against production (the bug this fixes).
  const env = normalizeEbayEnvironment(environment);
  const url = ebayTokenEndpoint(env);

  // 2. Create Base64 encoded credentials: <client_id>:<client_secret>
  const authString = `${normalizedClientId}:${normalizedClientSecret}`;
  const base64Auth = Buffer.from(authString).toString('base64');

  // 3. Configure headers
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': `Basic ${base64Auth}`,
  };

  // 4. Configure payload — the caller passes the account's role-matched scope
  //    set so a refresh never requests fewer scopes than consent granted (a
  //    buyer account refreshed with seller scopes would silently downgrade).
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: normalizedRefreshToken,
    scope: scopes,
  });

  // 5. Make the request
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
  } catch (error: any) {
    // Network-level failure — message only, never the request body/token.
    throw new Error(`Failed to reach eBay token endpoint: ${error?.message || error}`);
  }

  if (!response.ok) {
    // Surface the eBay error CODE only; never log the raw body (it can echo
    // request context) or the refresh token.
    let code = '';
    try {
      code = (JSON.parse(await response.text()) as { error?: string })?.error || '';
    } catch {
      /* non-JSON error body — intentionally ignored to avoid leaking it */
    }
    throw new Error(`eBay token refresh failed: HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }

  const tokenData = (await response.json()) as TokenResponse;
  return {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in || 7200, // Default 2 hours
  };
}

/**
 * Standalone script for manual token refresh
 * Run with: npx tsx src/lib/ebay/token-refresh.ts
 */
if (require.main === module) {
  require('dotenv').config();
  
  const CLIENT_ID = normalizeEnvValue(process.env.EBAY_APP_ID);
  const CLIENT_SECRET = normalizeEnvValue(process.env.EBAY_CERT_ID);
  const REFRESH_TOKEN = normalizeEnvValue(process.env.EBAY_REFRESH_TOKEN_USAV);
  const ENVIRONMENT = normalizeEbayEnvironment(process.env.EBAY_ENVIRONMENT);

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error('❌ Missing required environment variables:');
    console.error('   EBAY_APP_ID, EBAY_CERT_ID, EBAY_REFRESH_TOKEN_USAV');
    process.exit(1);
  }

  refreshEbayAccessToken(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, ENVIRONMENT)
    .then(({ accessToken, expiresIn }) => {
      // Never print the raw token (it's a live credential) — redact to a prefix.
      console.log('\n✅ eBay access token refreshed (redacted for safety):');
      console.log(`   ${accessToken.slice(0, 12)}… (${accessToken.length} chars)`);
      console.log(`⏰ Expires in: ${expiresIn} seconds (${expiresIn / 3600} hours)`);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
