import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { EbayClient } from '@/lib/ebay/client';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

export const maxDuration = 60;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function extractTrackingNumbers(ebayOrder: any): string[] {
  const fromInstructions =
    ebayOrder?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipmentTracking;
  const list = Array.isArray(fromInstructions) ? fromInstructions : [];
  const numbers = list
    .map((entry: any) => String(entry?.trackingNumber || '').trim())
    .filter(Boolean);
  return Array.from(new Set(numbers));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const lookbackDays = Number(body.lookbackDays || 30);
    const limitPerPage = Math.max(1, Math.min(500, Number(body.limitPerPage || body.limitPerAccount || 200)));
    const maxPages = Math.max(1, Math.min(50, Number(body.maxPages || 10)));
    const sinceIso = new Date(Date.now() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000).toISOString();

    const accountsResult = await pool.query(
      'SELECT account_name FROM ebay_accounts WHERE is_active = true ORDER BY account_name'
    );
    const accounts = accountsResult.rows.map((row: any) => String(row.account_name));

    if (accounts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active eBay accounts found',
        totals: { scanned: 0, matched: 0, updated: 0, unchanged: 0, unmatched: 0, errors: 0 },
        results: [],
      });
    }

    const results: any[] = [];
    let scanned = 0;
    let matched = 0;
    let updated = 0;
    let unchanged = 0;
    let unmatched = 0;
    let resolvedExceptions = 0;
    let errors = 0;

    for (const accountName of accounts) {
      const accountStats = {
        accountName,
        scanned: 0,
        matched: 0,
        updated: 0,
        unchanged: 0,
        unmatched: 0,
        errors: [] as string[],
      };

      try {
        const client = new EbayClient(accountName);
        const seenOrderIds = new Set<string>();
        const ebayOrders: any[] = [];

        for (let page = 0; page < maxPages; page++) {
          const offset = page * limitPerPage;
          const pageOrders = await client.fetchOrders({
            lastModifiedDate: sinceIso,
            limit: limitPerPage,
            offset,
          });

          if (!Array.isArray(pageOrders) || pageOrders.length === 0) break;

          for (const order of pageOrders) {
            const orderId = String(order?.orderId || '').trim();
            if (orderId && seenOrderIds.has(orderId)) continue;
            if (orderId) seenOrderIds.add(orderId);
            ebayOrders.push(order);
          }

          if (pageOrders.length < limitPerPage) break;
        }

        for (const ebayOrder of ebayOrders) {
          try {
            const orderId = String(ebayOrder?.orderId || '').trim();

            const lineItems = Array.isArray(ebayOrder?.lineItems) ? ebayOrder.lineItems : [];
            const firstItem = lineItems[0] || {};
            const trackingNumbers = extractTrackingNumbers(ebayOrder);
            const orderDate = ebayOrder?.creationDate ? new Date(ebayOrder.creationDate) : null;
            const productTitle = String(firstItem?.title || '').trim();
            const sku = String(firstItem?.sku || '').trim();
            const itemNumber = String(
              firstItem?.legacyItemId ||
              firstItem?.itemId ||
              firstItem?.lineItemId ||
              ''
            ).trim();
            const condition = String(firstItem?.condition || firstItem?.conditionId || '').trim();
            const quantity = firstItem?.quantity ? String(firstItem.quantity).trim() : '1';
            const candidateRows = trackingNumbers.length > 0 ? trackingNumbers : [''];

            for (const trackingNumber of candidateRows) {
              accountStats.scanned++;
              scanned++;

              const trackingKey18 = normalizeTrackingKey18(trackingNumber);
              if (!trackingKey18) {
                accountStats.unmatched++;
                unmatched++;
                continue;
              }

              const existingRows = await pool.query(
                `SELECT id, order_id, account_source, order_date, sku, item_number, shipping_tracking_number, product_title, condition, quantity
                 FROM orders
                 WHERE shipping_tracking_number IS NOT NULL
                   AND shipping_tracking_number != ''
                   AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                 ORDER BY created_at DESC NULLS LAST, id DESC
                 LIMIT 1`,
                [trackingKey18]
              );

              if (existingRows.rows.length === 0) {
                accountStats.unmatched++;
                unmatched++;
                continue;
              }

              accountStats.matched++;
              matched++;

              const current = existingRows.rows[0];
              const updates: string[] = [];
              const values: any[] = [];
              let idx = 1;

              if (isBlank(current.account_source)) {
                updates.push(`account_source = $${idx++}`);
                values.push(accountName);
              }
              if (!current.order_date && orderDate && !Number.isNaN(orderDate.getTime())) {
                updates.push(`order_date = $${idx++}`);
                values.push(orderDate);
              }
              if (isBlank(current.sku) && sku) {
                updates.push(`sku = $${idx++}`);
                values.push(sku);
              }
              if (isBlank(current.item_number) && itemNumber) {
                updates.push(`item_number = $${idx++}`);
                values.push(itemNumber);
              }
              if (isBlank(current.shipping_tracking_number) && trackingNumber) {
                updates.push(`shipping_tracking_number = $${idx++}`);
                values.push(trackingNumber);
              }
              if (isBlank(current.product_title) && productTitle) {
                updates.push(`product_title = $${idx++}`);
                values.push(productTitle);
              }
              if (isBlank(current.condition) && condition) {
                updates.push(`condition = $${idx++}`);
                values.push(condition);
              }
              if (isBlank(current.quantity) && quantity) {
                updates.push(`quantity = $${idx++}`);
                values.push(quantity);
              }
              if (isBlank(current.order_id) && orderId) {
                updates.push(`order_id = $${idx++}`);
                values.push(orderId);
              }

              if (updates.length === 0) {
                accountStats.unchanged++;
                unchanged++;
              } else {
                values.push(current.id);
                await pool.query(
                  `UPDATE orders SET ${updates.join(', ')} WHERE id = $${idx}`,
                  values
                );

                accountStats.updated++;
                updated++;
              }

              const resolveResult = await pool.query(
                `UPDATE orders_exceptions
                 SET status = 'resolved',
                     updated_at = NOW()
                 WHERE RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                   AND COALESCE(status, '') != 'resolved'`,
                [trackingKey18]
              );
              resolvedExceptions += resolveResult.rowCount || 0;
            }
          } catch (error: any) {
            accountStats.errors.push(error?.message || 'Unknown order error');
            errors++;
          }
        }
      } catch (error: any) {
        accountStats.errors.push(error?.message || 'Account sync failed');
        errors++;
      }

      results.push(accountStats);
    }

    return NextResponse.json({
      success: true,
      message: `eBay backfill completed: updated ${updated} order(s).`,
      totals: { scanned, matched, updated, unchanged, unmatched, resolvedExceptions, errors },
      results,
      accountsProcessed: accounts,
      pagination: { limitPerPage, maxPages },
      since: sinceIso,
    });
  } catch (error: any) {
    console.error('eBay backfill error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
