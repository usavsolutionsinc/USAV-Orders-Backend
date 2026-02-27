import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const DEFAULT_LIMIT = 100;

type ExceptionTrackingEntry = {
  ids: number[];
  rawTracking: string;
};

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  const keys = [primaryName, ...aliases];
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primaryName}`);
}

function parseEcwidOrderDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractEcwidTrackingNumbers(order: any): string[] {
  const tracking = String(
    order?.trackingNumber ??
      order?.shippingTrackingNumber ??
      order?.shippingInfo?.trackingNumber ??
      ''
  ).trim();

  return tracking ? [tracking] : [];
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

async function upsertEcwidOrder(params: {
  order: any;
  trackingNumber: string;
}): Promise<'created' | 'updated'> {
  const orderId = String(params.order?.orderNumber ?? params.order?.id ?? '').trim();
  const firstItem = Array.isArray(params.order?.items) ? params.order.items[0] || {} : {};
  const orderDate = parseEcwidOrderDate(params.order?.createDate ?? params.order?.created ?? params.order?.date);
  const sku = String(firstItem?.sku || '').trim();
  const productTitle = String(firstItem?.name || '').trim();
  const quantity = firstItem?.quantity ? String(firstItem.quantity).trim() : '1';

  let existingRows: any[] = [];

  if (orderId) {
    const byOrderId = await pool.query(
      `SELECT id
       FROM orders
       WHERE order_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [orderId]
    );
    existingRows = byOrderId.rows;
  }

  if (existingRows.length === 0) {
    const trackingKey18 = normalizeTrackingKey18(params.trackingNumber);
    if (trackingKey18) {
      const byTracking = await pool.query(
        `SELECT id
         FROM orders
         WHERE shipping_tracking_number IS NOT NULL
           AND shipping_tracking_number != ''
           AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
         ORDER BY id DESC
         LIMIT 1`,
        [trackingKey18]
      );
      existingRows = byTracking.rows;
    }
  }

  if (existingRows.length === 0) {
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
        packer_id,
        notes,
        quantity,
        out_of_stock,
        account_source,
        order_date,
        tester_id,
        ship_by_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )`,
      [
        orderId || null,
        productTitle || null,
        '',
        params.trackingNumber,
        sku || null,
        'shipped',
        JSON.stringify([]),
        true,
        5,
        '',
        quantity,
        '',
        'ecwid',
        orderDate,
        6,
        null,
      ]
    );

    return 'created';
  }

  const existingId = existingRows[0].id;
  await pool.query(
    `UPDATE orders
     SET order_id = COALESCE(NULLIF(order_id, ''), $1),
         product_title = COALESCE(NULLIF(product_title, ''), $2),
         shipping_tracking_number = COALESCE(NULLIF(shipping_tracking_number, ''), $3),
         sku = COALESCE(NULLIF(sku, ''), $4),
         quantity = COALESCE(NULLIF(quantity, ''), $5),
         account_source = COALESCE(NULLIF(account_source, ''), 'ecwid'),
         order_date = COALESCE(order_date, $6),
         is_shipped = true,
         status = CASE
           WHEN status IS NULL OR status = '' OR status = 'unassigned' THEN 'shipped'
           ELSE status
         END
     WHERE id = $7`,
    [
      orderId || null,
      productTitle || null,
      params.trackingNumber,
      sku || null,
      quantity,
      orderDate,
      existingId,
    ]
  );

  return 'updated';
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

    const exceptionMap = await loadExceptionTrackingMap();
    if (exceptionMap.size === 0) {
      return NextResponse.json({
        success: true,
        scanned: 0,
        matched: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        timestamp: new Date().toISOString(),
      });
    }

    const ecwidOrders = await fetchEcwidOrders(ecwidStoreId, ecwidApiToken, maxPages);

    let scanned = 0;
    let matched = 0;
    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const order of ecwidOrders) {
      const trackingNumbers = extractEcwidTrackingNumbers(order);
      if (trackingNumbers.length === 0) continue;

      for (const trackingNumber of trackingNumbers) {
        scanned += 1;
        const trackingKey18 = normalizeTrackingKey18(trackingNumber);
        if (!trackingKey18) continue;

        const entry = exceptionMap.get(trackingKey18);
        if (!entry || entry.ids.length === 0) continue;

        const result = await upsertEcwidOrder({ order, trackingNumber });
        if (result === 'created') created += 1;
        else updated += 1;

        const placeholders = entry.ids.map((_, i) => `$${i + 1}`).join(', ');
        const deleteResult = await pool.query(
          `DELETE FROM orders_exceptions WHERE id IN (${placeholders})`,
          entry.ids
        );

        matched += entry.ids.length;
        deleted += deleteResult.rowCount || 0;
        exceptionMap.delete(trackingKey18);
      }
    }

    return NextResponse.json({
      success: true,
      scanned,
      matched,
      created,
      updated,
      deleted,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error syncing Ecwid exception tracking:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to sync Ecwid exception tracking',
      },
      { status: 500 }
    );
  }
}
