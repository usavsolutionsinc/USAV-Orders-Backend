import {
  clearZohoTokens,
  getCachedZohoAccessToken,
  getZohoRefreshTokenFromKv,
  setZohoTokens,
} from '@/lib/zoho-kv';
import { normalizeEnvValue } from '@/lib/env-utils';

const ZOHO_ORG_ID =
  normalizeEnvValue(process.env.ZOHO_ORG_ID) || normalizeEnvValue(process.env.ZOHO_ORGANIZATION_ID);
const ZOHO_DOMAIN = normalizeEnvValue(process.env.ZOHO_DOMAIN) || 'accounts.zoho.com';
const ZOHO_CLIENT_ID = normalizeEnvValue(process.env.ZOHO_CLIENT_ID);
const ZOHO_CLIENT_SECRET = normalizeEnvValue(process.env.ZOHO_CLIENT_SECRET);

export function requireOrgId(): string {
  if (!ZOHO_ORG_ID) throw new Error('ZOHO_ORG_ID or ZOHO_ORGANIZATION_ID missing');
  return ZOHO_ORG_ID;
}

export function getInventoryBaseUrl() {
  if (ZOHO_DOMAIN.includes('.eu')) return 'https://inventory.zohoapis.eu/api/v1';
  if (ZOHO_DOMAIN.includes('.in')) return 'https://inventory.zohoapis.in/api/v1';
  if (ZOHO_DOMAIN.includes('.com.au')) return 'https://inventory.zohoapis.com.au/api/v1';
  if (ZOHO_DOMAIN.includes('.ca')) return 'https://inventory.zohoapis.ca/api/v1';
  if (ZOHO_DOMAIN.includes('.jp')) return 'https://inventory.zohoapis.jp/api/v1';
  return 'https://www.zohoapis.com/inventory/v1';
}

export function buildZohoUrl(
  path: string,
  query: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const params = new URLSearchParams({ organization_id: requireOrgId() });

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });

  let normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith('/api/v1')) {
    normalizedPath = normalizedPath.slice('/api/v1'.length) || '/';
  }

  return `${getInventoryBaseUrl()}${normalizedPath}?${params.toString()}`;
}

export async function getAccessToken(): Promise<string> {
  const cached = await getCachedZohoAccessToken();
  if (cached) return cached;

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
    throw new Error(
      'ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set. Visit /api/zoho/oauth/authorize to connect your Zoho account.'
    );
  }

  const refreshToken =
    normalizeEnvValue(process.env.ZOHO_REFRESH_TOKEN) ||
    normalizeEnvValue(await getZohoRefreshTokenFromKv());

  if (!refreshToken) {
    throw new Error(
      'No Zoho refresh token available. Visit /api/zoho/oauth/authorize to complete OAuth setup.'
    );
  }

  const tokenUrl = `https://${ZOHO_DOMAIN}/oauth/v2/token`;
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Zoho token refresh failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  if (data.error) {
    throw new Error(`Zoho token refresh error: ${data.error}`);
  }

  const accessToken = String(data.access_token || '');
  const expiresIn = Number(data.expires_in_sec || data.expires_in || 3600);
  await setZohoTokens({ accessToken, expiresIn });
  return accessToken;
}

export async function invalidateAccessToken(): Promise<void> {
  await clearZohoTokens();
}
