import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const DEFAULT_LIMIT = 100;

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  const keys = [primaryName, ...aliases];
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function getLastEightDigits(value: unknown): string {
  if (!value) return '';
  return String(value).replace(/\D/g, '').slice(-8);
}

function parseEcwidOrderDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchEcwidOrders(storeId: string, token: string, maxPages: number): Promise<any[]> {
  const items: any[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/orders`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(DEFAULT_LIMIT));

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ecwid orders request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { items?: any[] };
    const pageItems = Array.isArray(data.items) ? data.items : [];
    items.push(...pageItems);

    if (pageItems.length < DEFAULT_LIMIT) break;
    offset += DEFAULT_LIMIT;
  }

  return items;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const maxPages = Math.max(1, Math.min(50, Number(body.maxPages || 10)));

    const ecwidStoreId = requiredEnvAny('ECWID_STORE_ID', [
      'ECWID_STOREID',
      'ECWID_STORE',
      'NEXT_PUBLIC_ECWID_STORE_ID',
    ]);
    const ecwidApiToken = requiredEnvAny('ECWID_API_TOKEN', [
      'ECWID_TOKEN',
      'ECWID_ACCESS_TOKEN',
      'NEXT_PUBLIC_ECWID_API_TOKEN',
    ]);

    const ecwidOrders = await fetchEcwidOrders(ecwidStoreId, ecwidApiToken, maxPages);

    let scanned = 0;
    let matched = 0;
    let updated = 0;
    let unchanged = 0;
    let unmatched = 0;
    let errors = 0;

    for (const order of ecwidOrders) {
      scanned++;
      try {
        const orderId = String(order?.orderNumber ?? order?.id ?? '').trim();
        const firstItem = Array.isArray(order?.items) ? order.items[0] || {} : {};
        const trackingNumber = String(
          order?.trackingNumber ??
          order?.shippingTrackingNumber ??
          order?.shippingInfo?.trackingNumber ??
          ''
        ).trim();
        const orderDate = parseEcwidOrderDate(order?.createDate ?? order?.created ?? order?.date);
        const sku = String(firstItem?.sku || '').trim();
        const productTitle = String(firstItem?.name || '').trim();
        const quantity = firstItem?.quantity ? String(firstItem.quantity).trim() : '';

        let existingRows: any[] = [];

        if (orderId) {
          const byOrderId = await pool.query(
            `SELECT id, order_id, account_source, order_date, sku, item_number, shipping_tracking_number, product_title, quantity
             FROM orders
             WHERE order_id = $1
             ORDER BY created_at DESC NULLS LAST, id DESC
             LIMIT 1`,
            [orderId]
          );
          existingRows = byOrderId.rows;
        }

        if (existingRows.length === 0 && trackingNumber) {
          const last8 = getLastEightDigits(trackingNumber);
          if (last8) {
            const byTracking = await pool.query(
              `SELECT id, order_id, account_source, order_date, sku, item_number, shipping_tracking_number, product_title, quantity
               FROM orders
               WHERE shipping_tracking_number IS NOT NULL
                 AND shipping_tracking_number != ''
                 AND RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $1
               ORDER BY created_at DESC NULLS LAST, id DESC
               LIMIT 1`,
              [last8]
            );
            existingRows = byTracking.rows;
          }
        }

        if (existingRows.length === 0) {
          unmatched++;
          continue;
        }

        matched++;
        const current = existingRows[0];
        const updates: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (isBlank(current.order_id) && orderId) {
          updates.push(`order_id = $${idx++}`);
          values.push(orderId);
        }
        if (isBlank(current.account_source)) {
          updates.push(`account_source = $${idx++}`);
          values.push('ecwid');
        }
        if (!current.order_date && orderDate) {
          updates.push(`order_date = $${idx++}`);
          values.push(orderDate);
        }
        if (isBlank(current.sku) && sku) {
          updates.push(`sku = $${idx++}`);
          values.push(sku);
        }
        if (isBlank(current.item_number) && sku) {
          updates.push(`item_number = $${idx++}`);
          values.push(sku);
        }
        if (isBlank(current.shipping_tracking_number) && trackingNumber) {
          updates.push(`shipping_tracking_number = $${idx++}`);
          values.push(trackingNumber);
        }
        if (isBlank(current.product_title) && productTitle) {
          updates.push(`product_title = $${idx++}`);
          values.push(productTitle);
        }
        if (isBlank(current.quantity) && quantity) {
          updates.push(`quantity = $${idx++}`);
          values.push(quantity);
        }

        if (updates.length === 0) {
          unchanged++;
          continue;
        }

        values.push(current.id);
        await pool.query(
          `UPDATE orders SET ${updates.join(', ')} WHERE id = $${idx}`,
          values
        );
        updated++;
      } catch (error) {
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Ecwid backfill completed: updated ${updated} order(s).`,
      totals: { scanned, matched, updated, unchanged, unmatched, errors },
      pagination: { maxPages, pageSize: DEFAULT_LIMIT },
    });
  } catch (error: any) {
    console.error('Ecwid backfill error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
