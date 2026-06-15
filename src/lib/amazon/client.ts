/**
 * Amazon SP-API client — thin, zero-dependency `fetch` wrapper.
 *
 * House no-SDK pattern (cf. eBay's hand-rolled client + Stripe's deliberate SDK
 * avoidance). SP-API is LWA-only, so this is small: resolve a cached 1-hour
 * access token, call the regional host with `x-amz-access-token`, honor the
 * rate-limit header, back off on 429/503, and audit every call.
 *
 * Credentials come in two parts:
 *   - app-level LWA client_id/secret + redirect URI from env (shared SP-API app)
 *   - per-seller refresh token + region + marketplaces from the org vault
 *     (AmazonCredentials, provider='amazon', scope='seller-{id}')
 */
import { normalizeEnvValue } from '@/lib/env-utils';
import { tenantQuery } from '@/lib/tenancy/db';
import type { AmazonCredentials } from '@/lib/integrations/credentials';
import { SP_API_HOSTS, type AmazonRegion } from './constants';
import { exchangeRefreshToken, readAmazonToken, writeAmazonToken } from './token-refresh';

/** App-level (shared) SP-API config from env. */
export function amazonAppConfig() {
  return {
    clientId: normalizeEnvValue(process.env.AMAZON_LWA_CLIENT_ID),
    clientSecret: normalizeEnvValue(process.env.AMAZON_LWA_CLIENT_SECRET),
    appId: normalizeEnvValue(process.env.AMAZON_APP_ID),
    redirectUri: normalizeEnvValue(process.env.AMAZON_OAUTH_REDIRECT_URI),
    /** Draft (un-published) apps must append &version=beta to the consent URL. */
    draft: normalizeEnvValue(process.env.AMAZON_APP_DRAFT) === 'true',
  };
}

/** Runtime view of an amazon_accounts row (camelCase subset the client needs). */
export interface AmazonAccount {
  id: number;
  organizationId: string;
  accountName: string;
  sellerId: string | null;
  region: AmazonRegion;
  marketplaceIds: string[];
  accessToken: string | null;
  accessTokenExpiresAt: string | Date | null;
}

/** Map a raw amazon_accounts DB row (snake_case) to an AmazonAccount. */
export function toAmazonAccount(row: Record<string, any>): AmazonAccount {
  return {
    id: Number(row.id),
    organizationId: String(row.organization_id),
    accountName: String(row.account_name),
    sellerId: row.seller_id ?? null,
    region: (row.region || 'NA') as AmazonRegion,
    marketplaceIds: Array.isArray(row.marketplace_ids) ? row.marketplace_ids : [],
    accessToken: row.access_token ?? null,
    accessTokenExpiresAt: row.access_token_expires_at ?? null,
  };
}

const ACCESS_TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

/**
 * Return a valid LWA access token for an account, refreshing and persisting the
 * cached token to amazon_accounts when the current one is missing/near expiry.
 */
export async function getAccessTokenForAccount(
  account: AmazonAccount,
  creds: AmazonCredentials,
): Promise<string> {
  if (account.accessToken && account.accessTokenExpiresAt) {
    const expMs = new Date(account.accessTokenExpiresAt).getTime();
    if (Number.isFinite(expMs) && expMs - Date.now() > ACCESS_TOKEN_BUFFER_MS) {
      return readAmazonToken(account.accessToken);
    }
  }
  if (!creds.refreshToken) {
    throw new Error('Amazon account has no refresh token — reconnect the account.');
  }
  const { accessToken, expiresIn } = await exchangeRefreshToken(
    creds.lwaClientId, creds.lwaClientSecret, creds.refreshToken,
  );
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  await tenantQuery(
    account.organizationId,
    `UPDATE amazon_accounts
        SET access_token = $1, access_token_expires_at = $2, updated_at = now()
      WHERE id = $3 AND organization_id = $4`,
    [writeAmazonToken(accessToken), expiresAt, account.id, account.organizationId],
  ).catch((err) => {
    // Caching is best-effort; the token still works for this call.
    console.warn('[amazon/client] failed to persist access token:', err?.message || err);
  });
  account.accessToken = writeAmazonToken(accessToken);
  account.accessTokenExpiresAt = expiresAt;
  return accessToken;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CallSpApiOpts {
  operation: string;
  path: string;
  method?: string;
  query?: Record<string, string | string[] | number | undefined>;
  /** JSON request body (e.g. for the Tokens API). Sets method POST + content-type. */
  body?: unknown;
  /** Pre-fetched access token or RDT (overrides the cached LWA token). */
  accessToken?: string;
  maxRetries?: number;
}

/**
 * Perform an SP-API call. Reads x-amzn-RateLimit-Limit, retries 429/503 with
 * exponential backoff + jitter, and audits every call to amazon_api_calls.
 */
export async function callSpApi<T = any>(
  account: AmazonAccount,
  creds: AmazonCredentials,
  opts: CallSpApiOpts,
): Promise<T> {
  const method = opts.method || (opts.body ? 'POST' : 'GET');
  const host = SP_API_HOSTS[account.region] || SP_API_HOSTS.NA;
  const url = new URL(opts.path, host);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v === undefined) continue;
    // SP-API list params (MarketplaceIds, OrderStatuses) are repeated, not comma-joined.
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }

  const token = opts.accessToken ?? (await getAccessTokenForAccount(account, creds));
  const maxRetries = opts.maxRetries ?? 3;
  const started = Date.now();

  let lastErr: unknown = null;
  let statusCode: number | null = null;
  let rateLimit: string | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          'x-amz-access-token': token,
          'accept': 'application/json',
          'user-agent': 'USAV-Orders/1.0 (Language=TypeScript)',
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      statusCode = res.status;
      rateLimit = res.headers.get('x-amzn-RateLimit-Limit');

      if (res.status === 429 || res.status === 503) {
        if (attempt < maxRetries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 500 * 2 ** attempt + Math.floor(Math.random() * 400);
          await sleep(backoff);
          continue;
        }
      }

      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const detail = json?.errors?.[0]?.message || text || `HTTP ${res.status}`;
        throw new Error(`SP-API ${opts.operation} failed: HTTP ${res.status} ${detail}`);
      }
      await auditCall(account, opts, method, statusCode, true, rateLimit, Date.now() - started, null);
      return json as T;
    } catch (err) {
      lastErr = err;
      // Only retry transient network errors (the 429/503 path already continued above).
      if (attempt < maxRetries && statusCode === null) {
        await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 400));
        continue;
      }
      break;
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  await auditCall(account, opts, method, statusCode, false, rateLimit, Date.now() - started, message);
  throw lastErr instanceof Error ? lastErr : new Error(message);
}

async function auditCall(
  account: AmazonAccount,
  opts: CallSpApiOpts,
  method: string,
  statusCode: number | null,
  ok: boolean,
  rateLimit: string | null,
  durationMs: number,
  error: string | null,
): Promise<void> {
  try {
    await tenantQuery(
      account.organizationId,
      `INSERT INTO amazon_api_calls
         (organization_id, account_id, operation, method, path, status_code, ok, rate_limit, duration_ms, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        account.organizationId, account.id, opts.operation, method, opts.path,
        statusCode, ok, rateLimit, durationMs, error ? error.slice(0, 1000) : null,
      ],
    );
  } catch {
    // Audit must never break the call.
  }
}

/**
 * Sellers API — the canonical cheap "is this connection alive?" check.
 * Non-PII, low rate. Returns the marketplaces the seller participates in.
 */
export async function getMarketplaceParticipations(
  account: AmazonAccount,
  creds: AmazonCredentials,
  opts: { accessToken?: string } = {},
): Promise<Array<{ marketplaceId: string; countryCode?: string; name?: string }>> {
  const data = await callSpApi<{ payload?: Array<{ marketplace?: { id: string; countryCode?: string; name?: string } }> }>(
    account, creds,
    { operation: 'getMarketplaceParticipations', path: '/sellers/v1/marketplaceParticipations', accessToken: opts.accessToken },
  );
  return (data?.payload || [])
    .map((p) => p.marketplace)
    .filter((m): m is { id: string; countryCode?: string; name?: string } => !!m?.id)
    .map((m) => ({ marketplaceId: m.id, countryCode: m.countryCode, name: m.name }));
}

// ─── Orders API (v0) ────────────────────────────────────────────────────────

export interface AmazonOrderSummary {
  AmazonOrderId: string;
  PurchaseDate?: string;
  LastUpdateDate?: string;
  OrderStatus?: string;
  FulfillmentChannel?: 'AFN' | 'MFN' | string;
  SalesChannel?: string;
  MarketplaceId?: string;
  OrderTotal?: { CurrencyCode?: string; Amount?: string };
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  ShipmentServiceLevelCategory?: string;
  [k: string]: unknown;
}

export interface AmazonOrderItem {
  ASIN?: string;
  SellerSKU?: string;
  OrderItemId?: string;
  Title?: string;
  QuantityOrdered?: number;
  QuantityShipped?: number;
  ItemPrice?: { CurrencyCode?: string; Amount?: string };
  ConditionId?: string;
  [k: string]: unknown;
}

/**
 * Async generator over getOrders pages by NextToken. Yields one page (array of
 * order summaries) at a time so the caller can process + bail without buffering.
 */
export async function* getOrdersGenerator(
  account: AmazonAccount,
  creds: AmazonCredentials,
  params: { lastUpdatedAfter?: string; createdAfter?: string; orderStatuses?: string[]; maxResultsPerPage?: number },
): AsyncGenerator<AmazonOrderSummary[]> {
  let nextToken: string | undefined;
  do {
    const query: Record<string, string | string[] | number | undefined> = nextToken
      ? { NextToken: nextToken }
      : {
          MarketplaceIds: account.marketplaceIds,
          LastUpdatedAfter: params.lastUpdatedAfter,
          CreatedAfter: params.createdAfter,
          OrderStatuses: params.orderStatuses,
          MaxResultsPerPage: params.maxResultsPerPage ?? 100,
        };
    const data = await callSpApi<{ payload?: { Orders?: AmazonOrderSummary[]; NextToken?: string } }>(
      account, creds, { operation: 'getOrders', path: '/orders/v0/orders', query },
    );
    yield data?.payload?.Orders ?? [];
    nextToken = data?.payload?.NextToken || undefined;
  } while (nextToken);
}

/** Line items for one order (non-PII fields work with a normal access token). */
export async function getOrderItems(
  account: AmazonAccount,
  creds: AmazonCredentials,
  orderId: string,
): Promise<AmazonOrderItem[]> {
  const items: AmazonOrderItem[] = [];
  let nextToken: string | undefined;
  do {
    const data = await callSpApi<{ payload?: { OrderItems?: AmazonOrderItem[]; NextToken?: string } }>(
      account, creds, {
        operation: 'getOrderItems',
        path: `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`,
        query: nextToken ? { NextToken: nextToken } : undefined,
      },
    );
    items.push(...(data?.payload?.OrderItems ?? []));
    nextToken = data?.payload?.NextToken || undefined;
  } while (nextToken);
  return items;
}

export interface AmazonShippingAddress {
  Name?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  StateOrRegion?: string;
  PostalCode?: string;
  CountryCode?: string;
  Phone?: string;
  [k: string]: unknown;
}

/** Shipping address (PII) — requires an RDT passed as accessToken. */
export async function getOrderAddress(
  account: AmazonAccount,
  creds: AmazonCredentials,
  orderId: string,
  opts: { accessToken: string },
): Promise<AmazonShippingAddress | null> {
  const data = await callSpApi<{ payload?: { ShippingAddress?: AmazonShippingAddress } }>(
    account, creds, {
      operation: 'getOrderAddress',
      path: `/orders/v0/orders/${encodeURIComponent(orderId)}/address`,
      accessToken: opts.accessToken,
    },
  );
  return data?.payload?.ShippingAddress ?? null;
}

// ─── Tokens API (RDT for restricted PII) ────────────────────────────────────

export interface RestrictedResource {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  dataElements?: string[];
}

/** Mint a Restricted Data Token for PII-bearing calls (60-min TTL). */
export async function createRestrictedDataToken(
  account: AmazonAccount,
  creds: AmazonCredentials,
  restrictedResources: RestrictedResource[],
): Promise<{ token: string; expiresIn: number }> {
  const data = await callSpApi<{ restrictedDataToken?: string; expiresIn?: number }>(
    account, creds, {
      operation: 'createRestrictedDataToken',
      method: 'POST',
      path: '/tokens/2021-03-01/restrictedDataTokens',
      body: { restrictedResources },
    },
  );
  if (!data?.restrictedDataToken) throw new Error('Tokens API did not return a restrictedDataToken');
  return { token: data.restrictedDataToken, expiresIn: data.expiresIn ?? 3600 };
}
