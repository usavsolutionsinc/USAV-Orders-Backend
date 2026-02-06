import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/orders/verify - Verify if an order exists in the system
 * Used by label printer verification screen - checks if order exists regardless of pack status
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
      return NextResponse.json({ error: 'Tracking number required' }, { status: 400 });
    }

    // Fetch from orders table, join with packer_logs for pack status
    // Match only last 8 digits, return order regardless of pack status
    const result = await pool.query(`
      SELECT 
        o.order_id, 
        o.product_title, 
        o.condition, 
        o.shipping_tracking_number as tracking,
        o.is_shipped,
        pl.pack_date_time
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT pack_date_time
        FROM packer_logs
        WHERE shipping_tracking_number = o.shipping_tracking_number
          AND tracking_type = 'ORDERS'
        ORDER BY pack_date_time DESC NULLS LAST, id DESC
        LIMIT 1
      ) pl ON true
      WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT($1, 8)
      AND o.shipping_tracking_number IS NOT NULL 
      AND o.shipping_tracking_number != ''
      LIMIT 1
    `, [tracking]);

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
      packed: row.pack_date_time ? true : false,
      shipped: row.is_shipped || false
    });
  } catch (error: any) {
    console.error('Error verifying order:', error);
    return NextResponse.json({ 
      error: 'Failed to verify order', 
      details: error.message 
    }, { status: 500 });
  }
}
