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

    console.log('=== DEBUG TRACKING CHECK ===');
    console.log('Input tracking:', tracking);
    console.log('Input length:', tracking.length);
    console.log('Last 8 digits:', tracking.slice(-8));

    // Check if any orders match last 8 digits.
    // packer_id is sourced from work_assignments (removed from orders table).
    const matchResult = await pool.query(`
      SELECT
        o.id,
        o.order_id,
        o.shipping_tracking_number,
        o.is_shipped,
        o.status,
        wa_pack.assigned_packer_id AS packer_id,
        LENGTH(o.shipping_tracking_number) AS tracking_length,
        RIGHT(o.shipping_tracking_number, 8) AS db_last8
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT assigned_packer_id
        FROM work_assignments
        WHERE entity_type = 'ORDER'
          AND entity_id   = o.id
          AND work_type   = 'PACK'
        ORDER BY id DESC LIMIT 1
      ) wa_pack ON TRUE
      WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT($1, 8)
        AND o.shipping_tracking_number IS NOT NULL
        AND o.shipping_tracking_number != ''
      ORDER BY o.created_at DESC
    `, [tracking]);

    // Also check packer_logs
    const packerLogsResult = await pool.query(`
      SELECT 
        id,
        shipping_tracking_number,
        tracking_type,
        pack_date_time,
        packed_by
      FROM packer_logs
      WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)
      ORDER BY pack_date_time DESC NULLS LAST
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
        tracking: row.shipping_tracking_number,
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
