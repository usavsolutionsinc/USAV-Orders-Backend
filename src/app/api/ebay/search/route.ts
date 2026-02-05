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
        id, 
        order_id, 
        product_title, 
        sku,
        account_source, 
        order_date, 
        shipping_tracking_number,
        serial_number,
        ship_by_date
      FROM orders
      WHERE account_source IS NOT NULL
    `;

    const params: any[] = [];
    let paramCount = 1;

    // Search across multiple fields
    if (query && query.trim() !== '') {
      sql += ` AND (
        order_id ILIKE $${paramCount} OR
        sku ILIKE $${paramCount} OR
        product_title ILIKE $${paramCount} OR
        shipping_tracking_number ILIKE $${paramCount}
      )`;
      params.push(`%${query.trim()}%`);
      paramCount++;
    }

    // Filter by account
    if (accountFilter && accountFilter.trim() !== '') {
      sql += ` AND account_source = $${paramCount++}`;
      params.push(accountFilter.trim());
    }

    // Filter by status
    if (statusFilter && statusFilter.trim() !== '') {
      sql += ` AND order_status = $${paramCount++}`;
      params.push(statusFilter.trim());
    }

    sql += ` ORDER BY order_date DESC NULLS LAST LIMIT $${paramCount}`;
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
