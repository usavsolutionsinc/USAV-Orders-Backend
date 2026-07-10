import { NextRequest, NextResponse } from 'next/server';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { normalizeTrackingCanonical, normalizeTrackingKey18 } from '@/lib/tracking-format';
import { upsertOpenOrderException, type ExceptionSourceStation } from '@/lib/orders-exceptions';
import { checkRateLimitForOrg } from '@/lib/api-guard';
import { withAuth } from '@/lib/auth/withAuth';

type ScanTrackingRequest = {
  tracking?: string;
  sourceStation?: ExceptionSourceStation;
  exceptionReason?: string;
  notes?: string | null;
};

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const rate = await checkRateLimitForOrg({
      headers: req.headers,
      routeKey: 'scan-tracking',
      limit: 120,
      windowMs: 60_000,
      organizationId: ctx.organizationId,
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
    const staffId = ctx.staffId;
    const staffName = null;
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

    // withAuth guarantees an authenticated tenant here (AuthContext.organizationId
    // is non-nullable) — no fallback.
    const orgId = ctx.organizationId;

    return await withTenantTransaction(orgId, async (client) => {
      const key18MatchResult = await client.query(
        `SELECT
            o.id,
            o.order_id,
            o.product_title,
            o.condition,
            stn.tracking_number_raw AS tracking_number,
            COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
              OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped
         FROM orders o
         JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
         WHERE RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
         ORDER BY o.id DESC
         LIMIT 1`,
        [trackingKey18]
      );

      if (key18MatchResult.rows.length > 0) {
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
            tracking: row.tracking_number || rawTracking,
            shipped: Boolean(row.is_shipped),
          },
        });
      }

      const upsertResult = await upsertOpenOrderException({
        organizationId: ctx.organizationId,
        shippingTrackingNumber: rawTracking,
        sourceStation,
        staffId,
        staffName,
        reason: exceptionReason,
        notes: notes || `Scan not found in orders (${sourceStation})`,
      }, client, ctx.organizationId);

      if (upsertResult.matchedOrderId) {
        const matched = await client.query(
          `SELECT o.id, o.order_id, o.product_title, o.condition,
                  stn.tracking_number_raw AS tracking_number,
                  COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                    OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped
           FROM orders o
           LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
           WHERE o.id = $1 AND o.organization_id = $2
           LIMIT 1`,
          [upsertResult.matchedOrderId, ctx.organizationId]
        );
        if (matched.rows.length > 0) {
          const row = matched.rows[0];
          return NextResponse.json({
            success: true,
            found: true,
            order: {
              id: row.id,
              orderId: row.order_id || 'N/A',
              productTitle: row.product_title || 'Unknown Product',
              condition: row.condition || '',
              tracking: row.tracking_number || rawTracking,
              shipped: Boolean(row.is_shipped),
            },
          });
        }
      }
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
    });
  } catch (error: any) {
    console.error('Error scanning tracking:', error);
    return NextResponse.json(
      { success: false, found: false, error: 'Failed to scan tracking', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}, { permission: 'orders.view' });
