import { NextResponse, NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/ebay/search
 * Search orders across all eBay accounts
 * 
 * Query params:
 * - q: Search query (searches order_id, buyer, sku, product)
 * - account: Filter by specific account name
 * - limit: Max results to return (default 50)
 * - status: Filter by order status
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const accountFilter = searchParams.get('account');
    const statusFilter = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    let sql = `
      SELECT 
        o.id, 
        o.order_id, 
        o.product_title, 
        o.sku,
        o.account_source, 
        o.order_date, 
        stn.tracking_number_raw AS tracking_number,
        to_char(wa_deadline.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
        o.status,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
        COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') as serial_number
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT wa.deadline_at FROM work_assignments wa
        WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
          AND wa.organization_id = o.organization_id
        ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                 wa.updated_at DESC, wa.id DESC LIMIT 1
      ) wa_deadline ON TRUE
      LEFT JOIN tech_serial_numbers tsn ON o.shipment_id = tsn.shipment_id AND o.shipment_id IS NOT NULL
        AND tsn.organization_id = o.organization_id
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      WHERE o.account_source IS NOT NULL AND o.organization_id = $1
      GROUP BY o.id, o.order_id, o.product_title, o.sku, o.account_source, o.order_date,
               stn.tracking_number_raw, wa_deadline.deadline_at, o.status,
               stn.is_carrier_accepted, stn.is_in_transit, stn.is_out_for_delivery, stn.is_delivered
    `;

    const params: any[] = [ctx.organizationId];
    let paramCount = 2;

    // Search across multiple fields
    if (query && query.trim() !== '') {
      sql += ` AND (
        o.order_id ILIKE $${paramCount} OR
        o.sku ILIKE $${paramCount} OR
        o.product_title ILIKE $${paramCount} OR
        COALESCE(stn.tracking_number_raw, '') ILIKE $${paramCount} OR
        tsn.serial_number ILIKE $${paramCount}
      )`;
      params.push(`%${query.trim()}%`);
      paramCount++;
    }

    // Filter by account
    if (accountFilter && accountFilter.trim() !== '') {
      sql += ` AND o.account_source = $${paramCount++}`;
      params.push(accountFilter.trim());
    }

    // Filter by status
    if (statusFilter && statusFilter.trim() !== '') {
      sql += ` AND o.status = $${paramCount++}`;
      params.push(statusFilter.trim());
    }

    sql += ` ORDER BY o.order_date DESC NULLS LAST LIMIT $${paramCount}`;
    params.push(limit);

    const result = await tenantQuery(ctx.organizationId, sql, params);

    return NextResponse.json({
      success: true,
      orders: result.rows,
      count: result.rows.length,
      query: query || null,
      filters: {
        account: accountFilter || null,
        status: statusFilter || null,
      }
    });
  } catch (error: any) {
    console.error('Error searching eBay orders:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}, { permission: 'orders.view' });
