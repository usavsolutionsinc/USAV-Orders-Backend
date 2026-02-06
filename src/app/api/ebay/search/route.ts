import { NextResponse, NextRequest } from 'next/server';
import pool from '@/lib/db';

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
export async function GET(req: NextRequest) {
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
        o.shipping_tracking_number,
        o.ship_by_date,
        o.status,
        o.is_shipped,
        COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time), '') as serial_number
      FROM orders o
      LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
      WHERE o.account_source IS NOT NULL
      GROUP BY o.id, o.order_id, o.product_title, o.sku, o.account_source, o.order_date, 
               o.shipping_tracking_number, o.ship_by_date, o.status, o.is_shipped
    `;

    const params: any[] = [];
    let paramCount = 1;

    // Search across multiple fields
    if (query && query.trim() !== '') {
      sql += ` AND (
        o.order_id ILIKE $${paramCount} OR
        o.sku ILIKE $${paramCount} OR
        o.product_title ILIKE $${paramCount} OR
        o.shipping_tracking_number ILIKE $${paramCount} OR
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

    const result = await pool.query(sql, params);

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
}
