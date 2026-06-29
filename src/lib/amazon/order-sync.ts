/**
 * Amazon order import — getOrders by LastUpdatedAfter watermark → tracked-item
 * filter → upsert into `orders` (+ `customers` for MFN shipping address).
 *
 * Local-only (no Zoho). Lands in the operational `orders` table so orders are
 * immediately visible in the dashboard, mirroring the eBay precedent. FBA (AFN)
 * orders are imported read-only (status='shipped', fulfillment_channel='AFN')
 * and excluded from the unshipped to-do list by /api/orders. Item-scoped: by
 * default only orders whose SKU resolves to a tracked sku_catalog entry import.
 *
 * See docs/amazon-sp-api-order-import-plan.md.
 */
import type { PoolClient } from 'pg';
import { withTenantConnection } from '@/lib/tenancy/db';
import { resolveSkuCatalogId, resolveOrCreateSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { queuePendingSku } from '@/lib/inventory/pending-skus';
import type { AmazonCredentials } from '@/lib/integrations/credentials';
import {
  getOrdersGenerator,
  getOrderItems,
  getOrderAddress,
  createRestrictedDataToken,
  type AmazonAccount,
  type AmazonOrderSummary,
} from './client';
import { loadActiveAmazonAccounts, loadAmazonCreds } from './accounts';
import {
  isFbaOrder,
  fulfillmentChannelOf,
  mapAmazonStatus,
  representativeItem,
  mapShippingAddress,
  WATERMARK_OVERLAP_MS,
  FIRST_RUN_LOOKBACK_MS,
  type MappedCustomer,
} from './order-map';

export interface AmazonOrderSyncResult {
  accountName: string;
  skipped?: boolean; // claim held by another worker
  scanned: number;
  imported: number; // created
  updated: number;
  skippedUntracked: number;
  fbaReadOnly: number;
  watermark: string | null;
  errors?: string[];
}

export interface AmazonSyncOpts {
  /** Import every order, not just those with a tracked SKU (manual full pull). */
  importAll?: boolean;
  /** Fetch MFN buyer/shipping PII via RDT (best-effort; needs the approved role). Default true. */
  fetchPii?: boolean;
  /** Safety cap on orders processed per run (cron time budget). */
  maxOrders?: number;
}

const ORDER_STATUSES = [
  'Pending', 'Unshipped', 'PartiallyShipped', 'Shipped',
  'Canceled', 'Unfulfillable', 'InvoiceUnconfirmed', 'PendingAvailability',
];

export async function syncAmazonAccountOrders(
  account: AmazonAccount,
  creds: AmazonCredentials,
  opts: AmazonSyncOpts = {},
): Promise<AmazonOrderSyncResult> {
  const result: AmazonOrderSyncResult = {
    accountName: account.accountName,
    scanned: 0, imported: 0, updated: 0, skippedUntracked: 0, fbaReadOnly: 0,
    watermark: null, errors: [],
  };

  // Atomic claim — skip if another worker holds a fresh (<15 min) claim.
  const claim = await withTenantConnection(account.organizationId, (c) =>
    c.query(
      `UPDATE amazon_accounts
          SET sync_started_at = now(), updated_at = now()
        WHERE id = $1 AND organization_id = $2
          AND (sync_started_at IS NULL OR sync_started_at < now() - interval '15 minutes')
        RETURNING last_updated_watermark`,
      [account.id, account.organizationId],
    ),
  );
  if (claim.rowCount === 0) {
    result.skipped = true;
    delete result.errors;
    return result;
  }

  const priorWatermark: Date | null = claim.rows[0]?.last_updated_watermark
    ? new Date(claim.rows[0].last_updated_watermark)
    : null;
  const runStart = new Date();
  const lastUpdatedAfter = new Date(
    priorWatermark ? priorWatermark.getTime() - WATERMARK_OVERLAP_MS : Date.now() - FIRST_RUN_LOOKBACK_MS,
  );

  try {
    const maxOrders = opts.maxOrders ?? 1000;
    let stop = false;
    for await (const page of getOrdersGenerator(account, creds, {
      lastUpdatedAfter: lastUpdatedAfter.toISOString(),
      orderStatuses: ORDER_STATUSES,
      maxResultsPerPage: 100,
    })) {
      for (const order of page) {
        if (result.scanned >= maxOrders) { stop = true; break; }
        result.scanned++;
        try {
          await processOrder(account, creds, order, opts, result);
        } catch (err: any) {
          result.errors!.push(`order ${order.AmazonOrderId}: ${err?.message || err}`);
        }
      }
      if (stop) break;
    }

    // Advance the watermark only on a fully clean run.
    const cleanRun = result.errors!.length === 0;
    await withTenantConnection(account.organizationId, (c) =>
      c.query(
        `UPDATE amazon_accounts
            SET sync_started_at = NULL,
                last_sync_at = now(),
                status = CASE WHEN $3::boolean THEN 'active' ELSE 'error' END,
                last_error = $4,
                last_updated_watermark = CASE WHEN $3::boolean THEN $5 ELSE last_updated_watermark END,
                updated_at = now()
          WHERE id = $1 AND organization_id = $2`,
        [
          account.id, account.organizationId, cleanRun,
          cleanRun ? null : result.errors!.slice(0, 3).join(' | ').slice(0, 1000),
          runStart,
        ],
      ),
    );
    result.watermark = cleanRun ? runStart.toISOString() : (priorWatermark?.toISOString() ?? null);
  } catch (err: any) {
    // Release the claim, record the error, do NOT advance the watermark.
    await withTenantConnection(account.organizationId, (c) =>
      c.query(
        `UPDATE amazon_accounts
            SET sync_started_at = NULL, status = 'error', last_error = $3, updated_at = now()
          WHERE id = $1 AND organization_id = $2`,
        [account.id, account.organizationId, String(err?.message || err).slice(0, 1000)],
      ),
    ).catch(() => {});
    result.errors!.push(String(err?.message || err));
  }

  if (result.errors!.length === 0) delete result.errors;
  return result;
}

async function processOrder(
  account: AmazonAccount,
  creds: AmazonCredentials,
  order: AmazonOrderSummary,
  opts: AmazonSyncOpts,
  result: AmazonOrderSyncResult,
): Promise<void> {
  const orderId = String(order.AmazonOrderId || '').trim();
  if (!orderId) return;

  const items = await getOrderItems(account, creds, orderId);
  const item = representativeItem(items);
  const sku = String(item?.SellerSKU || '').trim();
  const asin = String(item?.ASIN || '').trim() || null;

  // Item-scope filter: tracked SKUs only, unless importAll.
  let skuCatalogId: number | null;
  if (opts.importAll) {
    skuCatalogId = await resolveOrCreateSkuCatalogId({
      sku: sku || null, itemNumber: asin, productTitle: item?.Title || null,
      accountSource: account.accountName, orderId,
    }, account.organizationId);
  } else {
    skuCatalogId = await resolveSkuCatalogId(sku || null, asin);
    if (skuCatalogId == null) {
      // Additive (§6 / Step D): an untracked or unmapped Amazon SKU (incl. the
      // literal 'No data' channel junk) is a "create in Zoho" to-do. Queue it
      // best-effort, then keep the existing skip behavior exactly — the order is
      // still NOT imported when not importing all.
      if (sku) {
        try {
          await queuePendingSku({ rawSku: sku, source: 'orders', suggestedTitle: item?.Title || null });
        } catch (err) {
          console.warn('amazon order-sync: queuePendingSku failed (non-fatal)', err);
        }
      }
      result.skippedUntracked++;
      return;
    }
  }

  const fba = isFbaOrder(order);
  if (fba) result.fbaReadOnly++;
  const status = mapAmazonStatus(order.OrderStatus, fba);
  const channel = fulfillmentChannelOf(order);

  // MFN shipping PII (best-effort; needs the Direct-to-Consumer Delivery role).
  let customer: MappedCustomer | null = null;
  if (!fba && opts.fetchPii !== false) {
    try {
      const { token } = await createRestrictedDataToken(account, creds, [
        { method: 'GET', path: `/orders/v0/orders/${orderId}/address`, dataElements: ['shippingAddress'] },
      ]);
      customer = mapShippingAddress(await getOrderAddress(account, creds, orderId, { accessToken: token }));
    } catch {
      // Role not approved / PII unavailable — import the order without an address.
    }
  }

  const productTitle = String(item?.Title || '').trim() || 'No title';
  const quantity = item?.QuantityOrdered != null ? String(item.QuantityOrdered) : '1';
  const orderDate = order.PurchaseDate ? new Date(order.PurchaseDate) : null;

  // Realized sale amount from the item's ItemPrice (SP-API getOrderItems).
  const rawAmount = item?.ItemPrice?.Amount != null ? Number(item.ItemPrice.Amount) : null;
  const saleAmount = rawAmount != null && !Number.isNaN(rawAmount) ? rawAmount : null;
  const currency = item?.ItemPrice?.CurrencyCode ?? 'USD';

  const outcome = await upsertAmazonOrder({
    orgId: account.organizationId,
    accountSource: account.accountName,
    sellerId: account.sellerId,
    orderId, productTitle, sku, quantity, status, channel, orderDate, skuCatalogId, customer,
    saleAmount, currency,
  });
  if (outcome === 'created') result.imported++;
  else result.updated++;
}

interface UpsertOrderInput {
  orgId: string;
  accountSource: string;
  sellerId: string | null;
  orderId: string;
  productTitle: string;
  sku: string;
  quantity: string;
  status: string;
  channel: 'AFN' | 'MFN';
  orderDate: Date | null;
  skuCatalogId: number | null;
  customer: MappedCustomer | null;
  saleAmount: number | null;
  currency: string;
}

async function upsertAmazonOrder(p: UpsertOrderInput): Promise<'created' | 'updated'> {
  return withTenantConnection(p.orgId, async (client) => {
    const existing = await client.query(
      `SELECT id, customer_id FROM orders
        WHERE account_source = $1 AND order_id = $2 AND organization_id = $3
        LIMIT 1`,
      [p.accountSource, p.orderId, p.orgId],
    );
    const existingId: number | null = existing.rows[0]?.id ?? null;
    let customerId: number | null = existing.rows[0]?.customer_id ?? null;

    if (p.customer && (p.customer.customerName || p.customer.shippingAddress1)) {
      customerId = await upsertCustomer(client, p, customerId);
    }

    if (existingId) {
      await client.query(
        `UPDATE orders SET
           product_title  = COALESCE(NULLIF($2, ''), product_title),
           sku            = COALESCE(NULLIF($3, ''), sku),
           quantity       = COALESCE(NULLIF($4, ''), quantity),
           order_date     = COALESCE(order_date, $5),
           sku_catalog_id = COALESCE(sku_catalog_id, $6),
           fulfillment_channel = $7,
           customer_id    = COALESCE($8, customer_id),
           status = CASE WHEN status IS NULL OR status IN ('', 'unassigned') THEN $9 ELSE status END
         WHERE id = $1 AND organization_id = $10`,
        [existingId, p.productTitle, p.sku, p.quantity, p.orderDate, p.skuCatalogId, p.channel, customerId, p.status, p.orgId],
      );
      return 'updated';
    }

    const ins = await client.query<{ inserted: boolean }>(
      `INSERT INTO orders (
         organization_id, order_id, product_title, condition, sku, status, status_history,
         notes, quantity, out_of_stock, account_source, order_date, sku_catalog_id,
         fulfillment_channel, customer_id, sale_amount, currency
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT ON CONSTRAINT idx_orders_unique_account_order DO UPDATE
         SET product_title  = COALESCE(NULLIF(EXCLUDED.product_title, 'No title'), orders.product_title),
             sku            = COALESCE(NULLIF(orders.sku, ''), EXCLUDED.sku),
             quantity       = COALESCE(NULLIF(orders.quantity, ''), EXCLUDED.quantity),
             order_date     = COALESCE(orders.order_date, EXCLUDED.order_date),
             sku_catalog_id = COALESCE(orders.sku_catalog_id, EXCLUDED.sku_catalog_id),
             fulfillment_channel = EXCLUDED.fulfillment_channel,
             customer_id    = COALESCE(orders.customer_id, EXCLUDED.customer_id),
             status = CASE WHEN orders.status IS NULL OR orders.status IN ('', 'unassigned')
                          THEN EXCLUDED.status ELSE orders.status END
       RETURNING (xmax = 0) AS inserted`,
      [
        p.orgId, p.orderId, p.productTitle, '', p.sku, p.status, JSON.stringify([]),
        '', p.quantity, '', p.accountSource, p.orderDate, p.skuCatalogId, p.channel, customerId,
        p.saleAmount, p.currency,
      ],
    );
    // xmax = 0 → a true INSERT; otherwise the ON CONFLICT update path fired (race).
    return ins.rows[0]?.inserted ? 'created' : 'updated';
  });
}

async function upsertCustomer(
  client: PoolClient,
  p: UpsertOrderInput,
  existingCustomerId: number | null,
): Promise<number> {
  const c = p.customer!;
  const channelRefs = JSON.stringify({
    amazon_order_id: p.orderId,
    ...(p.sellerId ? { seller_id: p.sellerId } : {}),
  });

  if (existingCustomerId) {
    await client.query(
      `UPDATE customers SET
         customer_name = COALESCE($2, customer_name),
         display_name  = COALESCE($2, display_name),
         first_name    = COALESCE($3, first_name),
         last_name     = COALESCE($4, last_name),
         phone         = COALESCE($5, phone),
         shipping_address_1 = $6, shipping_address_2 = $7, shipping_city = $8,
         shipping_state = $9, shipping_postal_code = $10, shipping_country = $11,
         channel_refs = $12::jsonb, updated_at = now()
       WHERE id = $1 AND organization_id = $13`,
      [
        existingCustomerId, c.customerName, c.firstName, c.lastName, c.phone,
        c.shippingAddress1, c.shippingAddress2, c.shippingCity, c.shippingState,
        c.shippingPostalCode, c.shippingCountry, channelRefs, p.orgId,
      ],
    );
    return existingCustomerId;
  }

  const ins = await client.query(
    `INSERT INTO customers (
       organization_id, customer_name, display_name, first_name, last_name, phone,
       shipping_address_1, shipping_address_2, shipping_city, shipping_state,
       shipping_postal_code, shipping_country, contact_type, entity_type, channel_refs,
       created_at, updated_at
     ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'customer', 'AMAZON_ORDER', $12::jsonb, now(), now())
     RETURNING id`,
    [
      p.orgId, c.customerName, c.firstName, c.lastName, c.phone,
      c.shippingAddress1, c.shippingAddress2, c.shippingCity, c.shippingState,
      c.shippingPostalCode, c.shippingCountry, channelRefs,
    ],
  );
  return Number(ins.rows[0].id);
}

/** Run the order sync for every active Amazon account in one org. */
export async function syncOrgAmazonOrders(
  orgId: string,
  opts: AmazonSyncOpts = {},
): Promise<{ orgId: string; accounts: AmazonOrderSyncResult[] }> {
  const accounts = await loadActiveAmazonAccounts(orgId);
  const results = await Promise.allSettled(
    accounts.map(async (account) => {
      const creds = await loadAmazonCreds(orgId, account);
      if (!creds?.refreshToken) {
        return {
          accountName: account.accountName, scanned: 0, imported: 0, updated: 0,
          skippedUntracked: 0, fbaReadOnly: 0, watermark: null,
          errors: ['No stored credentials — reconnect.'],
        } as AmazonOrderSyncResult;
      }
      return syncAmazonAccountOrders(account, creds, opts);
    }),
  );

  return {
    orgId,
    accounts: results.map((r, i): AmazonOrderSyncResult =>
      r.status === 'fulfilled'
        ? r.value
        : {
            accountName: accounts[i]?.accountName ?? 'unknown',
            scanned: 0, imported: 0, updated: 0, skippedUntracked: 0, fbaReadOnly: 0,
            watermark: null, errors: [String((r.reason as Error)?.message || r.reason)],
          },
    ),
  };
}
