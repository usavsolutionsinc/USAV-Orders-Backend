import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * DEBUG endpoint to check tracking number matching
 * GET /api/debug-tracking?tracking=XXXXX
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: 'Tracking number required' }, { status: 400 });
    }

    // Check if any orders match via shipment_id → shipping_tracking_numbers join.
    // shipping_tracking_numbers has no organization_id column (NEEDS-COL); it is
    // tenant-scoped here via the parent `orders` org filter + the surrogate-PK
    // join (stn.id = o.shipment_id). work_assignments carries org, so align it
    // to the order's org (entity_id/entity_type is a polymorphic key that can
    // collide across tenants).
    const matchResult = await tenantQuery(ctx.organizationId, `
      SELECT
        o.id,
        o.order_id,
        stn.tracking_number_raw AS tracking_number,
        COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
          OR stn.is_out_for_delivery OR stn.is_delivered, false) AS is_shipped,
        stn.latest_status_category AS shipment_status,
        o.status,
        wa_pack.assigned_packer_id AS packer_id,
        LENGTH(stn.tracking_number_raw) AS tracking_length,
        RIGHT(stn.tracking_number_raw, 8) AS db_last8
      FROM orders o
      JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
      LEFT JOIN LATERAL (
        SELECT assigned_packer_id
        FROM work_assignments
        WHERE entity_type = 'ORDER'
          AND entity_id   = o.id
          AND work_type   = 'PACK'
          AND organization_id = o.organization_id
        ORDER BY id DESC LIMIT 1
      ) wa_pack ON TRUE
      WHERE RIGHT(stn.tracking_number_raw, 8) = RIGHT($1, 8)
        AND o.organization_id = $2
      ORDER BY o.created_at DESC
    `, [tracking, ctx.organizationId]);

    // Also check packer_logs. packer_logs carries org → filter directly;
    // shipping_tracking_numbers (no org col) is scoped via its surrogate-PK
    // join to packer_logs (stn.id = pl.shipment_id).
    const packerLogsResult = await tenantQuery(ctx.organizationId, `
      SELECT
        pl.id,
        COALESCE(stn.tracking_number_raw, pl.scan_ref) AS tracking_number,
        pl.tracking_type,
        pl.created_at AS packed_at,
        pl.packed_by
      FROM packer_logs pl
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
      WHERE (stn.tracking_number_raw ILIKE $1
         OR pl.scan_ref ILIKE $1
         OR RIGHT(COALESCE(stn.tracking_number_raw, ''), 8) = RIGHT($1, 8))
        AND pl.organization_id = $2
      ORDER BY pl.created_at DESC NULLS LAST
      LIMIT 5
    `, [tracking, ctx.organizationId]);

    return NextResponse.json({
      inputTracking: tracking,
      inputLength: tracking.length,
      inputLast8: tracking.slice(-8),
      ordersMatched: matchResult.rows.length,
      orders: matchResult.rows.map(row => ({
        id: row.id,
        order_id: row.order_id,
        tracking: row.tracking_number,
        trackingLength: row.tracking_length,
        dbLast8: row.db_last8,
        isShipped: row.is_shipped,
        status: row.status,
        packerId: row.packer_id,
        matches: row.db_last8 === tracking.slice(-8)
      })),
      packerLogsMatched: packerLogsResult.rows.length,
      packerLogs: packerLogsResult.rows
    });
  } catch (error: any) {
    console.error('Error in debug-tracking:', error);
    return NextResponse.json({
      error: 'Failed to debug tracking',
      details: error.message
    }, { status: 500 });
  }
}, { permission: 'admin.view' });
