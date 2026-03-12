import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * DEBUG endpoint to check tracking number matching
 * GET /api/debug-tracking?tracking=XXXXX
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: 'Tracking number required' }, { status: 400 });
    }

    // Check if any orders match via shipment_id → shipping_tracking_numbers join.
    const matchResult = await pool.query(`
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
        ORDER BY id DESC LIMIT 1
      ) wa_pack ON TRUE
      WHERE RIGHT(stn.tracking_number_raw, 8) = RIGHT($1, 8)
      ORDER BY o.created_at DESC
    `, [tracking]);

    // Also check packer_logs
    const packerLogsResult = await pool.query(`
      SELECT
        pl.id,
        COALESCE(stn.tracking_number_raw, pl.scan_ref) AS tracking_number,
        pl.tracking_type,
        pl.pack_date_time,
        pl.packed_by
      FROM packer_logs pl
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
      WHERE stn.tracking_number_raw ILIKE $1
         OR pl.scan_ref ILIKE $1
         OR RIGHT(COALESCE(stn.tracking_number_raw, ''), 8) = RIGHT($1, 8)
      ORDER BY pl.pack_date_time DESC NULLS LAST
      LIMIT 5
    `, [tracking]);

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
}
