import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingCanonical, normalizeTrackingKey18 } from '@/lib/tracking-format';
import { upsertOpenOrderException, type ExceptionSourceStation } from '@/lib/orders-exceptions';
import { checkRateLimit } from '@/lib/api-guard';

type ScanTrackingRequest = {
  tracking?: string;
  sourceStation?: ExceptionSourceStation;
  staffId?: number | null;
  staffName?: string | null;
  exceptionReason?: string;
  notes?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const rate = checkRateLimit({
      headers: req.headers,
      routeKey: 'scan-tracking',
      limit: 120,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      return NextResponse.json(
        { success: false, found: false, error: 'Rate limit exceeded. Please retry shortly.' },
        { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined }
      );
    }

    const rawBody = await req.text();
    if (!rawBody?.trim()) {
      return NextResponse.json({ success: false, found: false, error: 'Request body is required' }, { status: 400 });
    }

    let body: ScanTrackingRequest;
    try {
      body = JSON.parse(rawBody) as ScanTrackingRequest;
    } catch {
      return NextResponse.json({ success: false, found: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawTracking = String(body.tracking || '').trim();
    const sourceStation = body.sourceStation || 'mobile';
    const staffId = body.staffId ?? null;
    const staffName = body.staffName ?? null;
    const exceptionReason = String(body.exceptionReason || 'not_found').trim() || 'not_found';
    const notes = body.notes ?? null;

    if (!rawTracking) {
      return NextResponse.json({ success: false, found: false, error: 'tracking is required' }, { status: 400 });
    }

    const normalizedFullTracking = normalizeTrackingCanonical(rawTracking);
    if (!normalizedFullTracking) {
      return NextResponse.json({ success: false, found: false, error: 'Invalid tracking number' }, { status: 400 });
    }
    if (normalizedFullTracking.length < 18) {
      return NextResponse.json({ success: false, found: false, error: 'Tracking number is too short' }, { status: 400 });
    }

    const trackingKey18 = normalizeTrackingKey18(rawTracking);
    if (!trackingKey18) {
      return NextResponse.json({ success: false, found: false, error: 'Invalid tracking number key' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const key18MatchResult = await client.query(
        `SELECT
            id,
            order_id,
            product_title,
            condition,
            shipping_tracking_number,
            is_shipped
         FROM orders
         WHERE shipping_tracking_number IS NOT NULL
           AND shipping_tracking_number != ''
           AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
         ORDER BY id DESC
         LIMIT 1`,
        [trackingKey18]
      );

      if (key18MatchResult.rows.length > 0) {
        await client.query('COMMIT');
        const row = key18MatchResult.rows[0];
        return NextResponse.json({
          success: true,
          found: true,
          matchStrategy: 'key18',
          order: {
            id: row.id,
            orderId: row.order_id || 'N/A',
            productTitle: row.product_title || 'Unknown Product',
            condition: row.condition || '',
            tracking: row.shipping_tracking_number || rawTracking,
            shipped: Boolean(row.is_shipped),
          },
        });
      }

      const upsertResult = await upsertOpenOrderException({
        shippingTrackingNumber: rawTracking,
        sourceStation,
        staffId,
        staffName,
        reason: exceptionReason,
        notes: notes || `Scan not found in orders (${sourceStation})`,
      }, client);

      if (upsertResult.matchedOrderId) {
        const matched = await client.query(
          `SELECT id, order_id, product_title, condition, shipping_tracking_number, is_shipped
           FROM orders
           WHERE id = $1
           LIMIT 1`,
          [upsertResult.matchedOrderId]
        );
        if (matched.rows.length > 0) {
          await client.query('COMMIT');
          const row = matched.rows[0];
          return NextResponse.json({
            success: true,
            found: true,
            order: {
              id: row.id,
              orderId: row.order_id || 'N/A',
              productTitle: row.product_title || 'Unknown Product',
              condition: row.condition || '',
              tracking: row.shipping_tracking_number || rawTracking,
              shipped: Boolean(row.is_shipped),
            },
          });
        }
      }
      await client.query('COMMIT');
      return NextResponse.json(
        {
          success: false,
          found: false,
          queuedException: true,
          exceptionId: upsertResult.exception?.id || null,
          error: 'Order not found. Tracking added to orders_exceptions.',
        },
        { status: 202 }
      );
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error scanning tracking:', error);
    return NextResponse.json(
      { success: false, found: false, error: 'Failed to scan tracking', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
