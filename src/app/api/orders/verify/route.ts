import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/orders/verify - Verify if an order exists in the system
 * Used by label printer verification screen - checks if order exists regardless of pack status.
 * Looks up by tracking number via shipping_tracking_numbers join (shipment_id FK).
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: 'Tracking number required' }, { status: 400 });
    }

    // Look up order via shipment_id → shipping_tracking_numbers join.
    // Tracking match is a cross-tenant-colliding string key, so the read is
    // anchored on the order's org (orders.organization_id).
    const result = await tenantQuery(orgId, `
      SELECT
        o.order_id,
        o.product_title,
        o.condition,
        stn.tracking_number_raw AS tracking,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
        pl.packed_at
      FROM orders o
      JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN LATERAL (
        SELECT created_at AS packed_at
        FROM packer_logs pl2
        WHERE pl2.shipment_id IS NOT NULL
          AND pl2.shipment_id = o.shipment_id
          AND pl2.tracking_type = 'ORDERS'
          AND pl2.organization_id = o.organization_id
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 1
      ) pl ON true
      WHERE RIGHT(regexp_replace(stn.tracking_number_normalized, '\\D', '', 'g'), 8)
            = RIGHT(regexp_replace($1, '\\D', '', 'g'), 8)
        AND o.organization_id = $2
      LIMIT 1
    `, [tracking, orgId]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        found: false,
        error: 'Order not found in system'
      });
    }

    const row = result.rows[0];

    return NextResponse.json({
      found: true,
      orderId: row.order_id || 'N/A',
      productTitle: row.product_title || 'Unknown Product',
      condition: row.condition || '',
      tracking: row.tracking,
      packed: row.packed_at ? true : false,
      shipped: row.is_shipped || false
    });
  } catch (error: any) {
    console.error('Error verifying order:', error);
    return NextResponse.json({
      error: 'Failed to verify order',
      details: error.message
    }, { status: 500 });
  }
}, { permission: 'orders.view' });
