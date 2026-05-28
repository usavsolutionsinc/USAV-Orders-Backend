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
 * READ-ONLY: no DB connection, no order creation, no eBay writes. The only
 * network calls are the OAuth token refresh (POST) and the order GET.
 *
 * It does NOT use EbayClient directly because that reads/decrypts tokens from
 * the Neon DB (needs INTEGRATION_KMS_KEY, which is not present in the Vercel
 * env). Accounts whose refresh token lives only in the DB are reported skipped.
 *
 * Usage:
 *   npx tsx scripts/e2e-ebay-orders.ts [envFile] [limit]
 *   # defaults: envFile=.env.e2e.tmp  limit=5
 */
import { config as loadEnv } from 'dotenv';
import { refreshEbayAccessToken } from '@/lib/ebay/token-refresh';
import { normalizeEnvValue } from '@/lib/env-utils';

const ENV_FILE = process.argv[2] || '.env.e2e.tmp';
const LIMIT = Math.max(1, Math.min(Number(process.argv[3]) || 5, 50));
const DAYS_BACK = 30; // matches src/lib/ebay/sync.ts sinceIso window

loadEnv({ path: ENV_FILE });

const ACCOUNTS = ['USAV', 'DRAGON', 'MEKONG'] as const;

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

  let testedAny = false;
  let hadFailure = false;

  for (const account of ACCOUNTS) {
    const refreshToken = normalizeEnvValue(process.env[`EBAY_REFRESH_TOKEN_${account}`]);
    console.log(`──────── ${account} ────────`);

    if (!refreshToken) {
      console.log(
        `  ⏭️  SKIPPED — no EBAY_REFRESH_TOKEN_${account} in env. ` +
          `(Token likely lives only in the Neon ebay_accounts table, which needs ` +
          `INTEGRATION_KMS_KEY to decrypt — not available via Vercel env.)\n`,
      );
      continue;
    }

    testedAny = true;
    try {
      const { accessToken, expiresIn } = await refreshEbayAccessToken(clientId, clientSecret, refreshToken);
      console.log(`  🔑 token refresh OK (expires in ${expiresIn}s)`);

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
            `(${rows.filter((r) => r.itemNumber).length}/${orders.length} resolve an item_number)\n`,
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
