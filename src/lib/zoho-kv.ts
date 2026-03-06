/**
 * Upstash KV storage for Zoho OAuth tokens.
 * Uses KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV / Upstash Redis REST API).
 */

const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

const KEYS = {
  refreshToken: 'zoho:refresh_token',
  accessToken: 'zoho:access_token',
} as const;

function isConfigured() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvPipeline(commands: string[][]): Promise<Array<{ result: unknown } | null>> {
  if (!isConfigured()) return [];
  const res = await fetch(`${KV_URL.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Returns the persisted Zoho refresh token from KV, or null if not found. */
export async function getZohoRefreshTokenFromKv(): Promise<string | null> {
  const results = await kvPipeline([['GET', KEYS.refreshToken]]);
  const value = results[0]?.result;
  return typeof value === 'string' && value ? value : null;
}

/** Returns a cached Zoho access token from KV (respects TTL set on write). */
export async function getCachedZohoAccessToken(): Promise<string | null> {
  const results = await kvPipeline([['GET', KEYS.accessToken]]);
  const value = results[0]?.result;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Persists Zoho tokens to KV.
 * - refreshToken is stored indefinitely (only updated on new OAuth grant).
 * - accessToken is stored with a TTL = expiresIn - 5 minutes (buffer).
 */
export async function setZohoTokens(tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}): Promise<void> {
  const ttl = Math.max(tokens.expiresIn - 300, 60);
  const commands: string[][] = [
    ['SET', KEYS.accessToken, tokens.accessToken, 'EX', String(ttl)],
  ];
  if (tokens.refreshToken) {
    commands.push(['SET', KEYS.refreshToken, tokens.refreshToken]);
  }
  await kvPipeline(commands);
}

/** Clears all stored Zoho tokens (useful for re-authorization). */
export async function clearZohoTokens(): Promise<void> {
  await kvPipeline([
    ['DEL', KEYS.accessToken],
    ['DEL', KEYS.refreshToken],
  ]);
}
