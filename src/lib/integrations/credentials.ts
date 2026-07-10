/**
 * Per-tenant integration credentials.
 *
 *   const creds = await getIntegrationCredentials<EbayCreds>(orgId, 'ebay');
 *
 * Resolution order:
 *   1. organization_integrations row for (orgId, provider)
 *   2. Env-var fallback — ONLY when orgId === USAV_ORG_ID. Lets us migrate
 *      USAV's existing single-tenant env-based config without breaking
 *      anything. Any other tenant that lacks a row gets `null` (not an
 *      env-var leak across tenants).
 *
 * Decrypted credentials are cached in-process for 5 minutes. Cache is
 * invalidated explicitly via invalidateCredentialCache() — the admin UI
 * that updates a credential must call it.
 *
 * Shapes for the most common providers are exported below; new providers
 * just add a type and a fallback resolver.
 */

import pool from '@/lib/db';
import { parseIntegrationPayload, serializeIntegrationPayload } from './crypto';
import { USAV_ORG_ID, type OrgId } from '../tenancy/constants';
import { getValidatedAblyApiKey } from '@/lib/realtime/ably-key';

// ─── Provider payload shapes ───────────────────────────────────────────────
// One discriminated union so callers get type-checked credentials back.

export type IntegrationProvider =
  | 'ebay'
  | 'amazon'
  | 'zoho'
  | 'ecwid'
  | 'square'
  | 'ups'
  | 'fedex'
  | 'usps'
  | 'zendesk'
  | 'google_sheets'
  | 'google_drive'
  | 'ably'
  | 'ollama'
  | 'stripe'
  | 'nextiva'
  | 'shipstation'
  // AI search providers (per-org BYOK — docs/ai-search-modernization-plan.md).
  // 'ollama' above doubles as the self-hosted/custom OpenAI-compatible slot.
  | 'ai_gateway'
  | 'openai'
  | 'anthropic';

export interface EbayCredentials {
  appId: string;
  certId: string;
  ruName: string;
  environment: 'PRODUCTION' | 'SANDBOX';
  refreshToken?: string;
}

/**
 * Amazon Selling Partner API credentials. LWA-only (no AWS IAM/SigV4 since
 * 2023-10-02). One row per seller account (scope='seller-{sellerId}'); the
 * app-level lwaClientId/lwaClientSecret are shared across tenants but copied
 * into each row so the payload is self-contained at runtime.
 */
export interface AmazonCredentials {
  lwaClientId: string;
  lwaClientSecret: string;
  refreshToken?: string;
  region: 'NA' | 'EU' | 'FE';
  marketplaceIds: string[];
  sellerId?: string;
}

export interface ZohoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  domain?: string;
  /**
   * Per-tenant webhook identity (Wave 3). Minted when the org connects Zoho:
   *   - webhookToken  — opaque, unguessable id used in the per-tenant webhook
   *     URL (/api/zoho/webhooks/{webhookToken}); also mirrored to the indexed
   *     organization_integrations.webhook_token column for O(1) token→org lookup.
   *   - webhookSecret — this org's OWN HMAC signing secret; the delivery is
   *     verified against it, so a forged body cannot cross tenants.
   * Both optional for back-compat with USAV's pre-Wave-3 env-secret connection.
   */
  webhookToken?: string;
  webhookSecret?: string;
}

/** Ecwid storefront — store id + secret API token (vault-first; env fallback
 *  for the dogfood org lives in fetchEcwidTransferRows, not here). */
export interface EcwidCredentials { storeId: string; apiToken: string }

export interface UpsCredentials { clientId: string; clientSecret: string; webhookSecret?: string }
export interface FedexCredentials { clientId: string; clientSecret: string; env: 'production' | 'sandbox' }
export interface UspsCredentials { consumerKey: string; consumerSecret: string }
export interface ZendeskCredentials { subdomain: string; email: string; apiToken: string }
export interface GoogleSheetsCredentials { clientEmail: string; privateKey: string; defaultSpreadsheetId?: string }

/**
 * Google Drive photo-backup credentials. Connected per-tenant via "Sign in with
 * Google" (OAuth, scope drive.file). The clientId/clientSecret are the SHARED
 * app credentials (one Google Cloud OAuth client for the whole platform) copied
 * into the row so the refresh path is self-contained at runtime — mirrors the
 * Amazon LWA model. The refreshToken + rootFolderId are the per-tenant secrets.
 *
 *   - rootFolderId   — the Drive folder this app created in the user's Drive;
 *     all backups land under it (and its yyyy/MM subfolders).
 *   - accountEmail   — the connected Google account (display only).
 *   - accessToken/expiresAt — last minted short-lived token (cache hint; the
 *     authoritative cache is in-process, see photos/drive/client.ts).
 */
export interface GoogleDriveCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  /** Access-token expiry, epoch ms. */
  expiresAt?: number;
  accountEmail?: string;
  rootFolderId: string;
  scope?: string;
}
export interface AblyCredentials { apiKey: string }
export interface OllamaCredentials {
  baseUrl: string;
  tunnelUrl?: string;
  model: string;
  /** Embedding model served by the same endpoint (e.g. nomic-embed-text). */
  embedModel?: string;
  /** Optional bearer for secured self-hosted endpoints. */
  apiKey?: string;
}

/**
 * Per-org AI search providers (BYOK). All speak the OpenAI wire format:
 * ai_gateway → https://ai-gateway.vercel.sh/v1 (any model string),
 * openai → https://api.openai.com/v1,
 * anthropic → https://api.anthropic.com/v1 (OpenAI-compat layer; CHAT ONLY —
 * Anthropic has no embeddings API, so embeds fall back to the next source).
 */
export interface AiGatewayCredentials { apiKey: string; chatModel?: string; embedModel?: string }
export interface OpenAiCredentials { apiKey: string; chatModel?: string; embedModel?: string }
export interface AnthropicCredentials { apiKey: string; chatModel?: string }
export interface StripeCredentials { secretKey: string; publishableKey: string; webhookSecret: string }

/**
 * Nextiva (business phone) credentials. Auth model is confirmed in the Phase 0
 * spike (docs/nextiva-voice-support-mode-plan.md §9) — vault API key vs OAuth
 * refresh token — so both shapes are optional here until that lands.
 *   - accountId / locationId — Nextiva account ref, used to resolve org on the
 *     (tokenless) legacy webhook path.
 *   - webhookToken  — our per-tenant, unguessable id in the webhook URL
 *     (/api/integrations/nextiva/webhook/{webhookToken}); also mirrored to the
 *     indexed organization_integrations.webhook_token column for O(1) token→org.
 *   - webhookSigningSecret — this org's OWN HMAC secret; deliveries are verified
 *     against it so a forged body cannot cross tenants. (Mirrors the Zoho model.)
 */
export interface NextivaCredentials {
  apiKey?: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  accountId?: string;
  locationId?: string;
  /** Nextiva extension to originate click-to-call from, per agent (optional). */
  defaultExtension?: string;
  webhookToken?: string;
  webhookSigningSecret?: string;
}

/**
 * ShipStation credentials.
 *   - apiKey        — the v2 (api.shipstation.com) API key: rate-shop, buy/void
 *                     labels, tracking, webhooks. REQUIRED for the label engine.
 *   - v1ApiKey / v1ApiSecret — the legacy v1 (ssapi.shipstation.com) Basic-auth
 *                     pair. OPTIONAL, but the ONLY way to pull orders (SKUs +
 *                     stored weight) since v2 has no order-list endpoint.
 *   - webhookToken / webhookSecret — per-tenant identity for the tokenized
 *                     webhook URL (mirrors the Zoho/Nextiva model): the token is
 *                     the unguessable path segment (also mirrored to
 *                     organization_integrations.webhook_token) and the secret is
 *                     this org's shared secret checked before the RSA signature.
 */
export interface ShipStationCredentials {
  apiKey: string;
  v1ApiKey?: string;
  v1ApiSecret?: string;
  webhookToken?: string;
  webhookSecret?: string;
}

// ─── Cache ─────────────────────────────────────────────────────────────────

interface CacheEntry { value: unknown; expiresAt: number; }
const credCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(orgId: OrgId, provider: IntegrationProvider, scope: string | null): string {
  return `${orgId}:${provider}:${scope ?? ''}`;
}

export function invalidateCredentialCache(orgId?: OrgId, provider?: IntegrationProvider): void {
  if (!orgId) { credCache.clear(); return; }
  const prefix = provider ? `${orgId}:${provider}:` : `${orgId}:`;
  for (const k of credCache.keys()) {
    if (k.startsWith(prefix)) credCache.delete(k);
  }
}

// ─── Env-var fallback (USAV org only, transitional) ────────────────────────
// Keep these tight — only USAV's existing single-tenant config is mirrored
// here so we can flip per-tenant lookups on without rewriting every
// integration module at once. Any new code MUST NOT add to this.

function envFallback(provider: IntegrationProvider): unknown | null {
  switch (provider) {
    case 'ebay': {
      const appId = process.env.EBAY_APP_ID, certId = process.env.EBAY_CERT_ID, ruName = process.env.EBAY_RU_NAME;
      if (!appId || !certId || !ruName) return null;
      const cred: EbayCredentials = {
        appId, certId, ruName,
        environment: (process.env.EBAY_ENVIRONMENT || 'PRODUCTION') as EbayCredentials['environment'],
        refreshToken: process.env.EBAY_REFRESH_TOKEN_USAV || undefined,
      };
      return cred;
    }
    case 'amazon': {
      // App-level LWA creds are shared (one SP-API app); USAV's bootstrap
      // refresh token is the only per-seller secret mirrored from env.
      const lwaClientId = process.env.AMAZON_LWA_CLIENT_ID, lwaClientSecret = process.env.AMAZON_LWA_CLIENT_SECRET;
      if (!lwaClientId || !lwaClientSecret) return null;
      const cred: AmazonCredentials = {
        lwaClientId, lwaClientSecret,
        refreshToken: process.env.AMAZON_SP_API_REFRESH_TOKEN_USAV || undefined,
        region: (process.env.AMAZON_SP_API_REGION || 'NA') as AmazonCredentials['region'],
        marketplaceIds: (process.env.AMAZON_MARKETPLACE_IDS || 'ATVPDKIKX0DER')
          .split(',').map((s) => s.trim()).filter(Boolean),
      };
      return cred;
    }
    case 'zoho': {
      const clientId = process.env.ZOHO_CLIENT_ID, clientSecret = process.env.ZOHO_CLIENT_SECRET,
            refreshToken = process.env.ZOHO_REFRESH_TOKEN,
            zohoOrg = process.env.ZOHO_ORG_ID || process.env.ZOHO_ORGANIZATION_ID;
      if (!clientId || !clientSecret || !refreshToken || !zohoOrg) return null;
      const cred: ZohoCredentials = { clientId, clientSecret, refreshToken, orgId: zohoOrg, domain: process.env.ZOHO_DOMAIN };
      return cred;
    }
    case 'ups': {
      const clientId = process.env.UPS_CLIENT_ID, clientSecret = process.env.UPS_CLIENT_SECRET;
      if (!clientId || !clientSecret) return null;
      const cred: UpsCredentials = {
        clientId, clientSecret,
        webhookSecret: process.env.UPS_WEBHOOK_BEARER || process.env.UPS_WEBHOOK_SECRET || undefined,
      };
      return cred;
    }
    case 'fedex': {
      const clientId = process.env.FEDEX_CLIENT_ID, clientSecret = process.env.FEDEX_CLIENT_SECRET;
      if (!clientId || !clientSecret) return null;
      const cred: FedexCredentials = {
        clientId, clientSecret,
        env: (process.env.FEDEX_ENV === 'production' ? 'production' : 'sandbox'),
      };
      return cred;
    }
    case 'usps': {
      const consumerKey = process.env.CONSUMER_KEY, consumerSecret = process.env.CONSUMER_SECRET;
      if (!consumerKey || !consumerSecret) return null;
      const cred: UspsCredentials = { consumerKey, consumerSecret };
      return cred;
    }
    case 'zendesk': {
      const subdomain = process.env.ZENDESK_SUBDOMAIN,
            email = process.env.ZENDESK_EMAIL || process.env.ZENDESK_API_USER,
            apiToken = process.env.ZENDESK_API_TOKEN;
      if (!subdomain || !email || !apiToken) return null;
      const cred: ZendeskCredentials = { subdomain, email, apiToken };
      return cred;
    }
    case 'google_sheets': {
      const clientEmail = process.env.GOOGLE_CLIENT_EMAIL, privateKey = process.env.GOOGLE_PRIVATE_KEY;
      if (!clientEmail || !privateKey) return null;
      const cred: GoogleSheetsCredentials = {
        clientEmail, privateKey,
        defaultSpreadsheetId: process.env.SPREADSHEET_ID,
      };
      return cred;
    }
    case 'ably': {
      const apiKey = getValidatedAblyApiKey();
      if (!apiKey) return null;
      const cred: AblyCredentials = { apiKey };
      return cred;
    }
    case 'ollama': {
      const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_TUNNEL_URL,
            model = process.env.OLLAMA_MODEL;
      if (!baseUrl || !model) return null;
      const cred: OllamaCredentials = { baseUrl, tunnelUrl: process.env.OLLAMA_TUNNEL_URL, model };
      return cred;
    }
    case 'stripe': {
      const secretKey = process.env.STRIPE_SECRET_KEY,
            publishableKey = process.env.STRIPE_PUBLISHABLE_KEY,
            webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secretKey || !publishableKey || !webhookSecret) return null;
      const cred: StripeCredentials = { secretKey, publishableKey, webhookSecret };
      return cred;
    }
    case 'nextiva': {
      // Vault-only by default; an env bootstrap is supported for USAV's single
      // tenant so the connector can light up before the settings Connect flow.
      const apiKey = process.env.NEXTIVA_API_KEY;
      const webhookSigningSecret = process.env.NEXTIVA_WEBHOOK_SECRET;
      if (!apiKey) return null;
      const cred: NextivaCredentials = {
        apiKey,
        accountId: process.env.NEXTIVA_ACCOUNT_ID || undefined,
        webhookToken: process.env.NEXTIVA_WEBHOOK_TOKEN || undefined,
        webhookSigningSecret: webhookSigningSecret || undefined,
      };
      return cred;
    }
    case 'shipstation': {
      // USAV single-tenant env bootstrap (mirrors nextiva) so the label engine
      // can light up before the settings Connect flow. apiKey = v2 key; the v1
      // pair + webhook secret are optional.
      const apiKey = process.env.SHIPSTATION_API_KEY;
      if (!apiKey) return null;
      const cred: ShipStationCredentials = {
        apiKey,
        v1ApiKey: process.env.SHIPSTATION_V1_API_KEY || undefined,
        v1ApiSecret: process.env.SHIPSTATION_V1_API_SECRET || undefined,
        webhookToken: process.env.SHIPSTATION_WEBHOOK_TOKEN || undefined,
        webhookSecret: process.env.SHIPSTATION_WEBHOOK_SECRET || undefined,
      };
      return cred;
    }
    case 'google_drive':
      // OAuth-only, connected per-tenant via Sign in with Google. No env bridge —
      // there is no single-tenant Drive backup to mirror from env.
      return null;
    case 'ecwid': case 'square':
      return null; // Add when needed.
  }
}

// ─── Legacy env bridge (USAV Zoho only, transitional) ───────────────────────
// USAV may still resolve Zoho from ZOHO_* env vars when the vault row is absent.
// Refresh token: ZOHO_REFRESH_TOKEN env, else ebay_accounts.ZOHO_MAIN (pre-vault).
async function readLegacyZohoRefreshToken(): Promise<string> {
  const fromEnv = (process.env.ZOHO_REFRESH_TOKEN ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    const { rows } = await pool.query<{ refresh_token: string | null }>(
      `SELECT refresh_token FROM ebay_accounts
        WHERE account_name = 'ZOHO_MAIN' AND platform = 'ZOHO'
        LIMIT 1`,
    );
    return (rows[0]?.refresh_token ?? '').trim();
  } catch {
    return '';
  }
}

async function legacyZohoFromEnv(): Promise<ZohoCredentials | null> {
  const clientId = (process.env.ZOHO_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.ZOHO_CLIENT_SECRET ?? '').trim();
  const zohoOrgId = (process.env.ZOHO_ORG_ID || process.env.ZOHO_ORGANIZATION_ID || '').trim();
  const domain = (process.env.ZOHO_DOMAIN ?? '').trim() || 'accounts.zoho.com';
  const refreshToken = await readLegacyZohoRefreshToken();
  if (!clientId || !clientSecret || !zohoOrgId || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, orgId: zohoOrgId, domain };
}

/** USAV transitional Zoho creds from env + legacy ZOHO_MAIN row (no vault). */
export async function resolveUsavLegacyZohoCredentials(): Promise<ZohoCredentials | null> {
  return legacyZohoFromEnv();
}

// ─── Public API ────────────────────────────────────────────────────────────

interface IntegrationDbRow {
  payload_encrypted: string;
  display_label: string | null;
  status: string;
  scope: string | null;
}

export async function getIntegrationCredentials<T = unknown>(
  orgId: OrgId,
  provider: IntegrationProvider,
  options: { scope?: string | null } = {},
): Promise<T | null> {
  const scope = options.scope ?? null;
  const key = cacheKey(orgId, provider, scope);
  const cached = credCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T | null;

  try {
    const r = await pool.query<IntegrationDbRow>(
      `SELECT payload_encrypted, display_label, status, scope
         FROM organization_integrations
        WHERE organization_id = $1
          AND provider = $2
          AND COALESCE(scope, '') = COALESCE($3, '')
          AND status = 'active'
        LIMIT 1`,
      [orgId, provider, scope],
    );
    const row = r.rows[0];
    if (row) {
      const value = parseIntegrationPayload<T>(row.payload_encrypted);
      credCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch (err) {
    // Decryption or DB errors are loud but non-fatal — fall through to env.
    console.warn(`[integrations] credentials lookup failed for ${orgId}/${provider}:`, err instanceof Error ? err.message : err);
  }

  // Transitional env-var fallback, USAV only.
  if (orgId === USAV_ORG_ID) {
    const fallback = envFallback(provider) as T | null;
    if (fallback) {
      credCache.set(key, { value: fallback, expiresAt: Date.now() + CACHE_TTL_MS });
      return fallback;
    }
    // Zoho env bridge for USAV when vault row is absent (refresh token in env or vault).
    if (provider === 'zoho') {
      const legacy = (await legacyZohoFromEnv()) as T | null;
      if (legacy) {
        credCache.set(key, { value: legacy, expiresAt: Date.now() + CACHE_TTL_MS });
        return legacy;
      }
    }
  }

  credCache.set(key, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
  return null;
}

export interface UpsertIntegrationInput {
  orgId: OrgId;
  provider: IntegrationProvider;
  scope?: string | null;
  payload: unknown;
  displayLabel?: string | null;
  createdBy?: number | null;
}

export async function upsertIntegrationCredentials(input: UpsertIntegrationInput): Promise<void> {
  const enc = serializeIntegrationPayload(input.payload);
  await pool.query(
    `INSERT INTO organization_integrations
       (organization_id, provider, scope, payload_encrypted, display_label, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'active', $6)
     ON CONFLICT (organization_id, provider, COALESCE(scope, ''))
     DO UPDATE SET
       payload_encrypted = EXCLUDED.payload_encrypted,
       display_label    = EXCLUDED.display_label,
       status           = 'active',
       last_error       = NULL,
       updated_at       = now()`,
    [input.orgId, input.provider, input.scope ?? null, enc, input.displayLabel ?? null, input.createdBy ?? null],
  );
  invalidateCredentialCache(input.orgId, input.provider);
}

export async function markIntegrationError(
  orgId: OrgId,
  provider: IntegrationProvider,
  error: string,
  scope: string | null = null,
): Promise<void> {
  await pool.query(
    `UPDATE organization_integrations
        SET status = 'error', last_error = $1, updated_at = now()
      WHERE organization_id = $2 AND provider = $3
        AND COALESCE(scope, '') = COALESCE($4, '')`,
    [error.slice(0, 1000), orgId, provider, scope],
  );
  invalidateCredentialCache(orgId, provider);
}

export async function deleteIntegrationCredentials(
  orgId: OrgId,
  provider: IntegrationProvider,
  scope: string | null = null,
): Promise<void> {
  await pool.query(
    `DELETE FROM organization_integrations
      WHERE organization_id = $1 AND provider = $2
        AND COALESCE(scope, '') = COALESCE($3, '')`,
    [orgId, provider, scope],
  );
  invalidateCredentialCache(orgId, provider);
}
