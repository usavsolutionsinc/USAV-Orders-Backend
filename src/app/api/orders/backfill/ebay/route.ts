import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { EbayClient } from '@/lib/ebay/client';

export const maxDuration = 60;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function extractTrackingFromOrder(ebayOrder: any): string {
  const fromInstructions =
    ebayOrder?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipmentTracking;
  const list = Array.isArray(fromInstructions) ? fromInstructions : [];
  return list.map((e: any) => String(e?.trackingNumber || '').trim()).filter(Boolean)[0] || '';
}

/**
 * POST /api/orders/backfill/ebay
 *
 * Strategy (update-only, no inserts):
 *  1. Find unshipped orders in our DB that have at least one blank critical field
 *     AND have a non-empty order_id we can look up on eBay.
 *  2. For each order, find the right eBay account (via account_source match) and
 *     call getOrderDetails(order_id) to retrieve the live eBay data.
 *  3. Fill in ONLY columns that are currently blank — never overwrite existing data.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(1000, Number(body.limit || 500)));

    // ── 1. Orders needing backfill ────────────────────────────────────────────
    const { rows: candidates } = await pool.query<{
      id: number;
      order_id: string;
      account_source: string | null;
      sku: string | null;
      item_number: string | null;
      product_title: string | null;
      condition: string | null;
      quantity: string | null;
      order_date: Date | null;
      shipping_tracking_number: string | null;
    }>(
      `SELECT id, order_id, account_source, sku, item_number, product_title,
              condition, quantity, order_date, shipping_tracking_number
       FROM orders
       WHERE is_shipped = FALSE
         AND COALESCE(order_id, '') != ''
         AND (
           COALESCE(sku, '')                       = '' OR
           COALESCE(item_number, '')               = '' OR
           COALESCE(product_title, '')             = '' OR
           COALESCE(condition, '')                 = '' OR
           COALESCE(quantity, '')                  = '' OR
           order_date IS NULL                         OR
           COALESCE(shipping_tracking_number, '') = ''  OR
           COALESCE(account_source, '')            = ''
         )
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No unshipped orders with blank fields found.',
        totals: { scanned: 0, updated: 0, unchanged: 0, notFound: 0, errors: 0 },
      });
    }

    // ── 2. Active eBay accounts ───────────────────────────────────────────────
    const { rows: accountRows } = await pool.query<{ account_name: string }>(
      'SELECT account_name FROM ebay_accounts WHERE is_active = true ORDER BY account_name'
    );
    const allAccountNames = accountRows.map((r) => r.account_name);

    if (allAccountNames.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active eBay accounts configured.' },
        { status: 400 }
      );
    }

    // Pre-build EbayClient instances (one per account)
    const clients = new Map<string, EbayClient>(
      allAccountNames.map((name) => [name, new EbayClient(name)])
    );

    /**
     * Pick accounts to try for a given account_source.
     * If the source matches an account name (case-insensitive contains), try that first.
     * Otherwise fall back to all accounts.
     */
    function accountsForSource(accountSource: string | null): string[] {
      if (!accountSource) return allAccountNames;
      const src = accountSource.toLowerCase();
      const match = allAccountNames.find(
        (name) => src.includes(name.toLowerCase()) || name.toLowerCase().includes(src)
      );
      return match ? [match, ...allAccountNames.filter((n) => n !== match)] : allAccountNames;
    }

    // ── 3. Process each candidate ─────────────────────────────────────────────
    let scanned = 0;
    let updated = 0;
    let unchanged = 0;
    let notFound = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    for (const order of candidates) {
      scanned++;
      try {
        // Try accounts in priority order until we get a result
        let ebayOrder: any = null;
        let matchedAccount = '';

        for (const accountName of accountsForSource(order.account_source)) {
          try {
            const client = clients.get(accountName)!;
            ebayOrder = await client.getOrderDetails(order.order_id);
            matchedAccount = accountName;
            break;
          } catch {
            // This account doesn't have the order — try the next
          }
        }

        if (!ebayOrder) {
          notFound++;
          continue;
        }

        // Extract fields from the eBay order
        const lineItems = Array.isArray(ebayOrder?.lineItems) ? ebayOrder.lineItems : [];
        const firstItem = lineItems[0] || {};
        const productTitle = String(firstItem?.title || '').trim();
        const sku = String(firstItem?.sku || '').trim();
        // legacyItemId is the eBay listing item number (e.g. "123456789")
        const itemNumber = String(
          firstItem?.legacyItemId || firstItem?.lineItemId || ''
        ).trim();
        const condition = String(firstItem?.condition || firstItem?.conditionId || '').trim();
        const quantity = firstItem?.quantity ? String(firstItem.quantity).trim() : '';
        const orderDate = ebayOrder?.creationDate ? new Date(ebayOrder.creationDate) : null;
        const trackingNumber = extractTrackingFromOrder(ebayOrder);

        // Build the SET clause — only patch blank columns
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (isBlank(order.product_title) && productTitle) {
          updates.push(`product_title = $${idx++}`); values.push(productTitle);
        }
        if (isBlank(order.sku) && sku) {
          updates.push(`sku = $${idx++}`); values.push(sku);
        }
        if (isBlank(order.item_number) && itemNumber) {
          updates.push(`item_number = $${idx++}`); values.push(itemNumber);
        }
        if (isBlank(order.condition) && condition) {
          updates.push(`condition = $${idx++}`); values.push(condition);
        }
        if (isBlank(order.quantity) && quantity) {
          updates.push(`quantity = $${idx++}`); values.push(quantity);
        }
        if (!order.order_date && orderDate && !Number.isNaN(orderDate.getTime())) {
          updates.push(`order_date = $${idx++}`); values.push(orderDate);
        }
        if (isBlank(order.shipping_tracking_number) && trackingNumber) {
          updates.push(`shipping_tracking_number = $${idx++}`); values.push(trackingNumber);
        }
        if (isBlank(order.account_source) && matchedAccount) {
          updates.push(`account_source = $${idx++}`); values.push(matchedAccount);
        }

        if (updates.length === 0) {
          unchanged++;
          continue;
        }

        values.push(order.id);
        await pool.query(
          `UPDATE orders SET ${updates.join(', ')} WHERE id = $${idx}`,
          values
        );
        updated++;
      } catch (err: any) {
        errors++;
        errorMessages.push(`order ${order.order_id}: ${err?.message || 'unknown error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `eBay backfill complete: ${updated} updated, ${unchanged} already complete, ${notFound} not found on eBay, ${errors} errors.`,
      totals: { scanned, updated, unchanged, notFound, errors },
      errorMessages: errorMessages.slice(0, 20),
    });
  } catch (error: any) {
    console.error('eBay backfill error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
