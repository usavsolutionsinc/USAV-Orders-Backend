/**
 * E2E (read-only): eBay account connection + live order fetch.
 *
 * Exercises the repo's REAL auth path — `refreshEbayAccessToken()` from
 * src/lib/ebay/token-refresh.ts (the same function EbayClient.refreshAccessToken
 * calls internally) — then replicates EbayClient.fetchOrders() exactly:
 * GET /sell/fulfillment/v1/order with a `lastmodifieddate:[since..]` filter and
 * the EBAY_US marketplace, asking for 5 orders. For each order we confirm the
 * first line item carries `legacyItemId` (the external ref id the sync writes to
 * orders.item_number — see src/lib/ebay/sync.ts).
 *
 * READ-ONLY: no order creation, no eBay writes, no DB writes. Network calls are
 * the OAuth token refresh (POST) and the order GET. A single read-only SELECT on
 * ebay_accounts sources each account's refresh token the same place the real
 * EbayClient does — the Neon DB — when it isn't supplied via env.
 *
 * Token resolution per account: EBAY_REFRESH_TOKEN_<ACCT> env var first, else the
 * ebay_accounts.refresh_token column. Plaintext tokens (eBay "v^..." format) are
 * used directly; encrypted envelopes are decrypted via the repo's
 * decryptIntegrationPayload (needs INTEGRATION_KMS_KEY).
 *
 * Usage:
 *   npx tsx scripts/e2e-ebay-orders.ts [envFile] [limit]
 *   # defaults: envFile=.env.e2e.tmp  limit=5
 */
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { refreshEbayAccessToken } from '@/lib/ebay/token-refresh';
import { normalizeEnvValue } from '@/lib/env-utils';
import { decryptIntegrationPayload } from '@/lib/integrations/crypto';

const ENV_FILE = process.argv[2] || '.env.e2e.tmp';
const LIMIT = Math.max(1, Math.min(Number(process.argv[3]) || 5, 50));
const DAYS_BACK = 30; // matches src/lib/ebay/sync.ts sinceIso window

loadEnv({ path: ENV_FILE });

const ACCOUNTS = ['USAV', 'DRAGON', 'MEKONG'] as const;

/** Read active eBay accounts' refresh tokens from the DB (read-only). */
async function loadDbRefreshTokens(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const url =
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return out;

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT account_name, refresh_token FROM ebay_accounts
       WHERE platform = 'EBAY' AND is_active = true`,
    );
    for (const row of res.rows) {
      const acct = String(row.account_name || '').trim();
      const raw = String(row.refresh_token || '').trim();
      if (!acct || !raw) continue;
      // eBay plaintext refresh tokens start with "v^"; anything else is an
      // encrypted envelope we decrypt with the same helper the client uses.
      let token = raw;
      if (!raw.startsWith('v^')) {
        try {
          token = decryptIntegrationPayload<string>(raw);
        } catch {
          continue; // can't decrypt (no/invalid INTEGRATION_KMS_KEY) — leave unset
        }
      }
      out.set(acct.toUpperCase(), token);
    }
  } finally {
    await client.end();
  }
  return out;
}

function apiBase(): string {
  // EbayClient: sandbox = EBAY_ENVIRONMENT !== 'PRODUCTION'
  return process.env.EBAY_ENVIRONMENT === 'PRODUCTION'
    ? 'https://api.ebay.com'
    : 'https://api.sandbox.ebay.com';
}

async function fetchOrdersFor(accountName: string, accessToken: string) {
  const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL(`${apiBase()}/sell/fulfillment/v1/order`);
  url.searchParams.set('limit', String(LIMIT));
  // Same filter shape EbayClient.fetchOrders() sends to sell.fulfillment.getOrders
  url.searchParams.set('filter', `lastmodifieddate:[${since}..]`);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`getOrders HTTP ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json().catch(() => ({} as any));
  return Array.isArray(data?.orders) ? data.orders : [];
}

function summarizeOrder(order: any) {
  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];
  const first = lineItems[0] || {};
  // Exactly what sync.ts reads into orders.item_number:
  const itemNumber = String(first?.legacyItemId || first?.lineItemId || '').trim() || null;
  return {
    orderId: String(order?.orderId || ''),
    creationDate: String(order?.creationDate || ''),
    orderFulfillmentStatus: String(order?.orderFulfillmentStatus || ''),
    lineItemCount: lineItems.length,
    legacyItemId: first?.legacyItemId ? String(first.legacyItemId) : null,
    lineItemId: first?.lineItemId ? String(first.lineItemId) : null,
    itemNumber,
    sku: first?.sku ? String(first.sku) : null,
    title: first?.title ? String(first.title).slice(0, 60) : null,
  };
}

async function main() {
  console.log(`\n=== eBay read-only e2e ===`);
  console.log(`env file:    ${ENV_FILE}`);
  console.log(`environment: ${process.env.EBAY_ENVIRONMENT || '(sandbox)'} -> ${apiBase()}`);
  console.log(`app id:      ${normalizeEnvValue(process.env.EBAY_APP_ID)?.slice(0, 18)}...`);
  console.log(`limit:       ${LIMIT} orders/account, lastmodified within ${DAYS_BACK}d\n`);

  const clientId = normalizeEnvValue(process.env.EBAY_APP_ID);
  const clientSecret = normalizeEnvValue(process.env.EBAY_CERT_ID);
  if (!clientId || !clientSecret) {
    console.error('❌ EBAY_APP_ID / EBAY_CERT_ID missing from env file.');
    process.exit(1);
  }

  const dbTokens = await loadDbRefreshTokens().catch((err) => {
    console.log(`  (DB token lookup unavailable: ${err?.message || err})`);
    return new Map<string, string>();
  });

  let testedAny = false;
  let hadFailure = false;

  for (const account of ACCOUNTS) {
    const envToken = normalizeEnvValue(process.env[`EBAY_REFRESH_TOKEN_${account}`]);
    const dbToken = dbTokens.get(account);
    const refreshToken = envToken || dbToken;
    const source = envToken ? 'env' : dbToken ? 'db' : null;
    console.log(`──────── ${account} ────────`);

    if (!refreshToken) {
      console.log(
        `  ⏭️  SKIPPED — no refresh token in env (EBAY_REFRESH_TOKEN_${account}) ` +
          `or in ebay_accounts (active EBAY rows). Encrypted DB tokens need INTEGRATION_KMS_KEY.\n`,
      );
      continue;
    }

    testedAny = true;
    try {
      const { accessToken, expiresIn } = await refreshEbayAccessToken(clientId, clientSecret, refreshToken);
      console.log(`  🔑 token refresh OK via ${source} token (expires in ${expiresIn}s)`);

      const orders = await fetchOrdersFor(account, accessToken);
      console.log(`  📦 fetched ${orders.length} order(s)`);

      const rows = orders.map(summarizeOrder);
      let withLegacy = 0;
      rows.forEach((r: ReturnType<typeof summarizeOrder>, i: number) => {
        if (r.legacyItemId) withLegacy++;
        console.log(
          `   ${i + 1}. order ${r.orderId} | ${r.creationDate} | ${r.orderFulfillmentStatus} | ` +
            `items=${r.lineItemCount} | legacyItemId=${r.legacyItemId ?? '—'} | ` +
            `sku=${r.sku ?? '—'} | ${r.title ?? ''}`,
        );
      });

      if (orders.length === 0) {
        console.log(`  ✅ connection OK (no orders in last ${DAYS_BACK}d to inspect)\n`);
      } else {
        console.log(
          `  ✅ ${account}: ${withLegacy}/${orders.length} orders carry legacyItemId ` +
            `(${rows.filter((r: ReturnType<typeof summarizeOrder>) => r.itemNumber).length}/${orders.length} resolve an item_number)\n`,
        );
      }
    } catch (err: any) {
      hadFailure = true;
      console.log(`  ❌ ${account} FAILED: ${err?.message || err}\n`);
    }
  }

  if (!testedAny) {
    console.log('⚠️  No accounts had a refresh token in env — nothing was tested live.');
    process.exit(2);
  }
  process.exit(hadFailure ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
