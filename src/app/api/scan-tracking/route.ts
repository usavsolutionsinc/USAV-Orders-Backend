import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { upsertOpenOrderException, type ExceptionSourceStation } from '@/lib/orders-exceptions';

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
    const rawBody = await req.text();
    if (!rawBody?.trim()) {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
    }

    let body: ScanTrackingRequest;
    try {
      body = JSON.parse(rawBody) as ScanTrackingRequest;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawTracking = String(body.tracking || '').trim();
    const sourceStation = body.sourceStation || 'mobile';
    const staffId = body.staffId ?? null;
    const staffName = body.staffName ?? null;
    const exceptionReason = String(body.exceptionReason || 'not_found').trim() || 'not_found';
    const notes = body.notes ?? null;

    if (!rawTracking) {
      return NextResponse.json({ error: 'tracking is required' }, { status: 400 });
    }

    const normalizedFullTracking = rawTracking.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalizedFullTracking) {
      return NextResponse.json({ error: 'Invalid tracking number' }, { status: 400 });
    }
    if (normalizedFullTracking.length < 8) {
      return NextResponse.json({ error: 'Tracking number is too short' }, { status: 400 });
    }

    // Match by normalized tracking key (rightmost 18 chars).
    const trackingKey18 = normalizeTrackingKey18(rawTracking);
    if (!trackingKey18) {
      return NextResponse.json({ error: 'Invalid tracking number key' }, { status: 400 });
    }

    const key18MatchResult = await pool.query(
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
         AND RIGHT(regexp_replace(UPPER(shipping_tracking_number), '[^A-Z0-9]', '', 'g'), 18) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [trackingKey18]
    );

    if (key18MatchResult.rows.length > 0) {
      const row = key18MatchResult.rows[0];
      return NextResponse.json({
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
    });

    if (upsertResult.matchedOrderId) {
      const matched = await pool.query(
        `SELECT id, order_id, product_title, condition, shipping_tracking_number, is_shipped
         FROM orders
         WHERE id = $1
         LIMIT 1`,
        [upsertResult.matchedOrderId]
      );
      if (matched.rows.length > 0) {
        const row = matched.rows[0];
        return NextResponse.json({
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

    return NextResponse.json(
      {
        found: false,
        queuedException: true,
        exceptionId: upsertResult.exception?.id || null,
        error: 'Order not found. Tracking added to orders_exceptions.',
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error('Error scanning tracking:', error);
    return NextResponse.json(
      { error: 'Failed to scan tracking', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
