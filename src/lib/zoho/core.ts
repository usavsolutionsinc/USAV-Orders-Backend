/**
 * Zoho Inventory client core — credential resolution, URL building, and access
 * token minting, all scoped to a tenant `orgId`.
 *
 * Source of truth for credentials is `organization_integrations` (provider
 * 'zoho'), read through `getIntegrationCredentials`. For the USAV org that
 * lookup transparently falls back to the ZOHO_* env vars (see
 * src/lib/integrations/credentials.ts → envFallback), so this module needs no
 * env vars of its own and the cutover is invisible to the single live tenant.
 *
 * The durable secret (refresh token + client id/secret + Zoho org id + data
 * center) lives ONLY in the vault. The short-lived access token (~1h) is cached
 * in-process per org; it is a cache, not a system of record — a cold start just
 * re-mints it from the refresh token.
 */

import pool from '@/lib/db';
import {
  getIntegrationCredentials,
  type ZohoCredentials,
} from '@/lib/integrations/credentials';
import { USAV_ORG_ID, type OrgId } from '@/lib/tenancy/constants';
import { accountsDomain, buildZohoUrl, getInventoryBaseUrl } from '@/lib/zoho/url';

export type { ZohoCredentials };
// Re-exported so existing importers of '@/lib/zoho/core' (and the '@/lib/zoho'
// barrel) keep their import paths; the pure logic now lives in ./url.
export { buildZohoUrl, getInventoryBaseUrl };

/** Thrown when an org has no usable Zoho connection (not connected / revoked). */
export class ZohoNotConnectedError extends Error {
  constructor(public readonly orgId: OrgId) {
    super(
      `No active Zoho connection for org ${orgId}. ` +
        'Connect via Settings → Integrations (/api/zoho/oauth/authorize).',
    );
    this.name = 'ZohoNotConnectedError';
  }
}

// ─── Per-org access-token cache (in-process; short-lived) ───────────────────
interface CachedAccessToken { token: string; expiresAt: number; }
const accessTokenCache = new Map<OrgId, CachedAccessToken>();
// Refresh a little before the real expiry so an in-flight request never races
// the boundary.
const ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

function isComplete(creds: ZohoCredentials | null | undefined): creds is ZohoCredentials {
  return Boolean(creds && creds.refreshToken && creds.clientId && creds.clientSecret && creds.orgId);
}

/**
 * Transitional legacy bridge (USAV only) — mirrors the pre-vault runtime so
 * USAV keeps working off its CURRENT config while the vault is the SoT:
 *   - client id/secret + Zoho org id/data center from the ZOHO_* env vars
 *   - refresh token from ZOHO_REFRESH_TOKEN env, else the legacy
 *     `ebay_accounts.ZOHO_MAIN` row (where prod's token actually lives)
 *
 * This is the reason a plain env fallback was insufficient: the durable refresh
 * token is stored in the DB, not in env. Removed in Phase 5 once the vault row
 * is populated from a real (prod) connect/migration.
 */
async function loadLegacyZohoCredentials(orgId: OrgId): Promise<ZohoCredentials | null> {
  if (orgId !== USAV_ORG_ID) return null;

  const clientId = (process.env.ZOHO_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.ZOHO_CLIENT_SECRET ?? '').trim();
  const zohoOrgId = (process.env.ZOHO_ORG_ID || process.env.ZOHO_ORGANIZATION_ID || '').trim();
  const domain = (process.env.ZOHO_DOMAIN ?? '').trim() || 'accounts.zoho.com';
  if (!clientId || !clientSecret || !zohoOrgId) return null;

  let refreshToken = (process.env.ZOHO_REFRESH_TOKEN ?? '').trim();
  if (!refreshToken) {
    try {
      const { rows } = await pool.query<{ refresh_token: string | null }>(
        `SELECT refresh_token FROM ebay_accounts WHERE account_name = 'ZOHO_MAIN' LIMIT 1`,
      );
      refreshToken = (rows[0]?.refresh_token ?? '').trim();
    } catch {
      /* table/row may not exist — fall through to "not connected" */
    }
  }
  if (!refreshToken) return null;

  return { clientId, clientSecret, refreshToken, orgId: zohoOrgId, domain };
}

/**
 * Load the tenant's Zoho credentials. Resolution order — USAV can use BOTH:
 *   1. the per-tenant vault (organization_integrations, provider 'zoho') — SoT
 *   2. the legacy env + `ebay_accounts.ZOHO_MAIN` bridge (USAV transitional)
 * Throws ZohoNotConnectedError when neither yields a usable connection so
 * callers surface a connect prompt instead of a generic 500.
 */
export async function loadZohoCredentials(orgId: OrgId): Promise<ZohoCredentials> {
  const vault = await getIntegrationCredentials<ZohoCredentials>(orgId, 'zoho');
  if (isComplete(vault)) return vault;

  const legacy = await loadLegacyZohoCredentials(orgId);
  if (isComplete(legacy)) return legacy;

  throw new ZohoNotConnectedError(orgId);
}

/**
 * A valid short-lived access token for the tenant. Returns the cached token
 * when it still has > 5 min of life; otherwise mints a fresh one from the
 * refresh token and caches it. Pass `creds` to avoid a second vault read when
 * the caller already loaded them.
 */
export async function getAccessToken(orgId: OrgId, creds?: ZohoCredentials): Promise<string> {
  const cached = accessTokenCache.get(orgId);
  if (cached && cached.expiresAt > Date.now() + ACCESS_TOKEN_SKEW_MS) return cached.token;

  const c = creds ?? (await loadZohoCredentials(orgId));
  const tokenUrl = `https://${accountsDomain(c)}/oauth/v2/token`;
  const params = new URLSearchParams({
    refresh_token: c.refreshToken,
    client_id: c.clientId,
    client_secret: c.clientSecret,
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

  const data = (await response.json()) as Record<string, unknown>;
  if (data.error) {
    throw new Error(`Zoho token refresh error: ${data.error}`);
  }

  const accessToken = String(data.access_token || '');
  const expiresIn = Number(data.expires_in_sec || data.expires_in || 3600);
  accessTokenCache.set(orgId, { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 });
  return accessToken;
}

/** Drop the cached access token for an org (e.g. after a 401), forcing a mint. */
export function invalidateAccessToken(orgId: OrgId): void {
  accessTokenCache.delete(orgId);
}
