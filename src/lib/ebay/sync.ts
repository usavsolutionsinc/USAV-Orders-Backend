import { EbayClient } from './client';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

export interface SyncResult {
  accountName: string;
  fetchedOrders: number;
  scannedTracking: number;
  matchedExceptions: number;
  createdOrders: number;
  deletedExceptions: number;
  skippedExistingOrders: number;
  lastSyncDate: string | null;
  errors?: string[];
}

type ExceptionTrackingEntry = {
  ids: number[];
  rawTracking: string;
};

function extractTrackingNumbers(ebayOrder: any): string[] {
  const fromInstructions = ebayOrder?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipmentTracking;
  const list = Array.isArray(fromInstructions) ? fromInstructions : [];

  return Array.from(
    new Set(
      list
        .map((entry: any) => String(entry?.trackingNumber || '').trim())
        .filter(Boolean)
    )
  );
}

function extractTrackingFromFulfillments(fulfillments: any[]): string[] {
  const values: string[] = [];
  for (const row of fulfillments) {
    const direct = String(row?.shipmentTrackingNumber || '').trim();
    if (direct) values.push(direct);

    const nested = Array.isArray(row?.shipmentTracking) ? row.shipmentTracking : [];
    for (const item of nested) {
      const tracking = String(item?.trackingNumber || '').trim();
      if (tracking) values.push(tracking);
    }
  }
  return Array.from(new Set(values.filter(Boolean)));
}

async function loadExceptionTrackingMap(): Promise<Map<string, ExceptionTrackingEntry>> {
  const result = await pool.query(
    `SELECT id, shipping_tracking_number
     FROM orders_exceptions
     ORDER BY id ASC`
  );

  const map = new Map<string, ExceptionTrackingEntry>();
  for (const row of result.rows) {
    const rawTracking = String(row.shipping_tracking_number || '').trim();
    const trackingKey18 = normalizeTrackingKey18(rawTracking);
    if (!trackingKey18) continue;

    const current = map.get(trackingKey18);
    if (current) {
      current.ids.push(row.id);
    } else {
      map.set(trackingKey18, {
        ids: [row.id],
        rawTracking,
      });
    }
  }

  return map;
}

async function createOrUpdateOrderFromEbayTracking(params: {
  accountName: string;
  ebayOrder: any;
  trackingNumber: string;
}): Promise<'created' | 'updated'> {
  const orderId = String(params.ebayOrder?.orderId || '').trim() || null;
  const lineItems = Array.isArray(params.ebayOrder?.lineItems) ? params.ebayOrder.lineItems : [];
  const firstItem = lineItems[0] || {};

  const productTitle = String(firstItem?.title || '').trim() || 'No title';
  const condition = String(firstItem?.condition || firstItem?.conditionId || '').trim();
  const sku = String(firstItem?.sku || '').trim();
  const quantity = firstItem?.quantity ? String(firstItem.quantity).trim() : '1';
  const orderDateRaw = params.ebayOrder?.creationDate ? new Date(params.ebayOrder.creationDate) : null;
  const orderDate = orderDateRaw && !Number.isNaN(orderDateRaw.getTime()) ? orderDateRaw : null;

  const trackingKey18 = normalizeTrackingKey18(params.trackingNumber);
  if (!trackingKey18) return 'updated';

  // Check by tracking number first
  const existingByTracking = await pool.query(
    `SELECT id
     FROM orders
     WHERE shipping_tracking_number IS NOT NULL
       AND shipping_tracking_number != ''
       AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
     ORDER BY id DESC
     LIMIT 1`,
    [trackingKey18]
  );

  // Also check by (account_source, order_id) to avoid idx_orders_unique_account_order violations
  let existingId: number | null = existingByTracking.rows[0]?.id ?? null;
  if (!existingId && orderId && params.accountName) {
    const existingByOrderId = await pool.query(
      `SELECT id FROM orders WHERE account_source = $1 AND order_id = $2 LIMIT 1`,
      [params.accountName, orderId]
    );
    existingId = existingByOrderId.rows[0]?.id ?? null;
  }

  if (existingId) {
    await pool.query(
      `UPDATE orders
       SET order_id = COALESCE(NULLIF(order_id, ''), $1),
           product_title = COALESCE(NULLIF(product_title, ''), $2),
           condition = COALESCE(NULLIF(condition, ''), $3),
           shipping_tracking_number = COALESCE(NULLIF(shipping_tracking_number, ''), $4),
           sku = COALESCE(NULLIF(sku, ''), $5),
           quantity = COALESCE(NULLIF(quantity, ''), $6),
           account_source = COALESCE(NULLIF(account_source, ''), $7),
           order_date = COALESCE(order_date, $8),
           is_shipped = true,
           status = CASE
             WHEN status IS NULL OR status = '' OR status = 'unassigned' THEN 'shipped'
             ELSE status
           END
       WHERE id = $9`,
      [
        orderId,
        productTitle,
        condition,
        params.trackingNumber,
        sku,
        quantity,
        params.accountName,
        orderDate,
        existingId,
      ]
    );

    return 'updated';
  }

  await pool.query(
    `INSERT INTO orders (
      order_id,
      product_title,
      condition,
      shipping_tracking_number,
      sku,
      status,
      status_history,
      is_shipped,
      notes,
      quantity,
      out_of_stock,
      account_source,
      order_date
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13
    )
    ON CONFLICT ON CONSTRAINT idx_orders_unique_account_order DO UPDATE
      SET product_title = COALESCE(NULLIF(EXCLUDED.product_title, 'No title'), orders.product_title),
          condition = COALESCE(NULLIF(orders.condition, ''), EXCLUDED.condition),
          shipping_tracking_number = COALESCE(NULLIF(orders.shipping_tracking_number, ''), EXCLUDED.shipping_tracking_number),
          sku = COALESCE(NULLIF(orders.sku, ''), EXCLUDED.sku),
          quantity = COALESCE(NULLIF(orders.quantity, ''), EXCLUDED.quantity),
          order_date = COALESCE(orders.order_date, EXCLUDED.order_date),
          is_shipped = true,
          status = CASE
            WHEN orders.status IS NULL OR orders.status = '' OR orders.status = 'unassigned' THEN 'shipped'
            ELSE orders.status
          END`,
    [
      orderId,
      productTitle,
      condition,
      params.trackingNumber,
      sku,
      'shipped',
      JSON.stringify([]),
      true,
      '',
      quantity,
      '',
      params.accountName,
      orderDate,
    ]
  );

  return 'created';
}

/**
 * Exceptions-first eBay sync:
 * 1) Load tracking numbers from orders_exceptions — these drive the entire sync
 * 2) Page through eBay orders (last 30 days) and check embedded tracking against exception map
 * 3) Only call getOrderShippingFulfillments for orders with no embedded tracking
 * 4) Stop paging as soon as all exceptions are resolved
 * 5) Create/update orders rows and delete matched exceptions
 */
export async function syncAccountOrders(accountName: string): Promise<SyncResult> {
  console.log(`[${accountName}] Starting exceptions-first eBay sync`);

  const errors: string[] = [];
  let fetchedOrders = 0;
  let scannedTracking = 0;
  let matchedExceptions = 0;
  let createdOrders = 0;
  let deletedExceptions = 0;
  let skippedExistingOrders = 0;

  try {
    const client = new EbayClient(accountName);

    const lastSyncResult = await pool.query(
      'SELECT last_sync_date FROM ebay_accounts WHERE account_name = $1',
      [accountName]
    );
    const lastSyncDate = lastSyncResult.rows[0]?.last_sync_date;

    // Load all exception tracking numbers first — this is our work list
    const exceptionMap = await loadExceptionTrackingMap();
    if (exceptionMap.size === 0) {
      await pool.query(
        'UPDATE ebay_accounts SET last_sync_date = NOW(), updated_at = NOW() WHERE account_name = $1',
        [accountName]
      );
      return {
        accountName,
        fetchedOrders: 0,
        scannedTracking: 0,
        matchedExceptions: 0,
        createdOrders: 0,
        deletedExceptions: 0,
        skippedExistingOrders: 0,
        lastSyncDate: lastSyncDate ? new Date(lastSyncDate).toISOString() : null,
      };
    }

    console.log(`[${accountName}] ${exceptionMap.size} exception tracking(s) to resolve`);

    const limitPerPage = 200;
    const maxPages = 50;
    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const seenOrderIds = new Set<string>();

    outer: for (let page = 0; page < maxPages; page++) {
      // Stop fetching pages once all exceptions have been resolved
      if (exceptionMap.size === 0) break;

      const offset = page * limitPerPage;
      const pageOrders = await client.fetchOrders({
        lastModifiedDate: sinceIso,
        limit: limitPerPage,
        offset,
      });

      if (!Array.isArray(pageOrders) || pageOrders.length === 0) break;
      fetchedOrders += pageOrders.length;

      for (const ebayOrder of pageOrders) {
        // Stop mid-page too if all exceptions resolved
        if (exceptionMap.size === 0) break outer;

        try {
          const orderId = String(ebayOrder?.orderId || '').trim();
          if (orderId && seenOrderIds.has(orderId)) continue;
          if (orderId) seenOrderIds.add(orderId);

          // Check embedded tracking from the order payload first — no extra API call needed
          let trackingNumbers = extractTrackingNumbers(ebayOrder);

          const embeddedMatchKey = trackingNumbers
            .map(normalizeTrackingKey18)
            .find((k) => k && exceptionMap.has(k));

          if (!embeddedMatchKey) {
            if (trackingNumbers.length > 0) {
              // Has embedded tracking but none match an exception — skip this order entirely
              continue;
            }

            // No embedded tracking at all — call fulfillments API since tracking may live there
            if (orderId) {
              try {
                const fulfillments = await client.getOrderShippingFulfillments(orderId);
                const fulfillmentTracking = extractTrackingFromFulfillments(fulfillments);
                if (fulfillmentTracking.length > 0) {
                  trackingNumbers = Array.from(new Set([...trackingNumbers, ...fulfillmentTracking]));
                }
              } catch (error: any) {
                errors.push(`Order ${orderId}: ${error?.message || 'shipping fulfillment fetch failed'}`);
              }
            }
          }

          if (trackingNumbers.length === 0) continue;

          for (const trackingNumber of trackingNumbers) {
            scannedTracking += 1;

            const trackingKey18 = normalizeTrackingKey18(trackingNumber);
            if (!trackingKey18) continue;

            const exceptionEntry = exceptionMap.get(trackingKey18);
            if (!exceptionEntry || exceptionEntry.ids.length === 0) continue;

            const upsertResult = await createOrUpdateOrderFromEbayTracking({
              accountName,
              ebayOrder,
              trackingNumber,
            });

            if (upsertResult === 'created') {
              createdOrders += 1;
            } else {
              skippedExistingOrders += 1;
            }

            const placeholders = exceptionEntry.ids.map((_, i) => `$${i + 1}`).join(', ');
            const deleted = await pool.query(
              `DELETE FROM orders_exceptions WHERE id IN (${placeholders})`,
              exceptionEntry.ids
            );

            matchedExceptions += exceptionEntry.ids.length;
            deletedExceptions += deleted.rowCount || 0;

            exceptionMap.delete(trackingKey18);
          }
        } catch (error: any) {
          const message = error?.message || 'Unknown order error';
          console.error(`[${accountName}] Error processing order ${ebayOrder?.orderId || 'unknown'}:`, message);
          errors.push(message);
        }
      }

      if (pageOrders.length < limitPerPage) break;
    }

    await pool.query(
      'UPDATE ebay_accounts SET last_sync_date = NOW(), updated_at = NOW() WHERE account_name = $1',
      [accountName]
    );

    console.log(
      `[${accountName}] Sync completed: fetched=${fetchedOrders}, matchedExceptions=${matchedExceptions}, createdOrders=${createdOrders}, deletedExceptions=${deletedExceptions}, remainingUnresolved=${exceptionMap.size}`
    );

    return {
      accountName,
      fetchedOrders,
      scannedTracking,
      matchedExceptions,
      createdOrders,
      deletedExceptions,
      skippedExistingOrders,
      lastSyncDate: lastSyncDate ? new Date(lastSyncDate).toISOString() : null,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error: any) {
    console.error(`[${accountName}] Sync failed:`, error?.message || error);
    throw new Error(`Failed to sync ${accountName}: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Sync all active eBay accounts
 */
export async function syncAllAccounts(): Promise<Array<{
  account: string;
  status: 'fulfilled' | 'rejected';
  data: SyncResult | null;
  error: string | null;
}>> {
  const accountsResult = await pool.query(
    'SELECT account_name FROM ebay_accounts WHERE is_active = true ORDER BY account_name'
  );

  const accounts = accountsResult.rows.map((row) => row.account_name);

  if (accounts.length === 0) {
    console.log('No active eBay accounts found');
    return [];
  }

  console.log(`Syncing ${accounts.length} accounts: ${accounts.join(', ')}`);

  const results = await Promise.allSettled(accounts.map((account) => syncAccountOrders(account)));

  return results.map((result, i) => ({
    account: accounts[i],
    status: result.status,
    data: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? result.reason.message : null,
  }));
}

/**
 * Get sync status for all accounts
 */
export async function getSyncStatus() {
  const result = await pool.query(
    `SELECT
      account_name,
      last_sync_date,
      is_active,
      token_expires_at,
      created_at
    FROM ebay_accounts
    ORDER BY account_name`
  );

  return result.rows.map((row) => ({
    accountName: row.account_name,
    lastSyncDate: row.last_sync_date,
    isActive: row.is_active,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
  }));
}
