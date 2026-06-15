import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/shipped/lookup-order?order_id=xxx
 * Lookup order by order_id in shipped table and return product_title
 */
export async function GET(req: NextRequest) {
  try {
    // order_id is a STRING key that collides across tenants, so this lookup must
    // be tenant-scoped. Resolve the caller's org from the session permission gate.
    const gate = await requireRoutePerm(req, 'shipping.view');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('order_id');

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Query orders table for matching order_id (shipped orders only).
    // shipping_tracking_numbers has no organization_id column; scope via the
    // orders parent (o.organization_id) plus the GUC-wrapped connection.
    // Return product_title
    const result = await tenantQuery(
      orgId,
      `SELECT o.product_title
       FROM orders o
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
       WHERE o.order_id = $1
         AND o.organization_id = $2
         AND COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
               OR stn.is_out_for_delivery OR stn.is_delivered, false)
       LIMIT 1`,
      [orderId, orgId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { found: false, message: 'Order ID not found' },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    
    return NextResponse.json({
      found: true,
      product_title: row.product_title || '',
    });
  } catch (error: any) {
    console.error('Error looking up order:', error);
    return NextResponse.json(
      { error: 'Failed to lookup order', details: error.message },
      { status: 500 }
    );
  }
}
