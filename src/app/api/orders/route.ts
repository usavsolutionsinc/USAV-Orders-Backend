import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * GET /api/orders - Fetch all orders with optional filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const assignedTo = searchParams.get('assignedTo');
    const cacheLookup = createCacheLookupKey({ status: status || '', assignedTo: assignedTo || '' });

    const cached = await getCachedJson<any>('api:orders', cacheLookup);
    if (cached) {
      return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
    }

    let query = `
      SELECT 
        id,
        to_char(ship_by_date, 'YYYY-MM-DD') as ship_by_date,
        order_id,
        product_title,
        item_number,
        quantity,
        sku,
        condition,
        shipping_tracking_number,
        out_of_stock,
        notes,
        packer_id,
        tester_id,
        is_shipped,
        created_at
      FROM orders
      WHERE (is_shipped = false OR is_shipped IS NULL)
    `;
    const params: any[] = [];
    let paramCount = 1;

    if (status) {
      query += ` AND status = $${paramCount++}`;
      params.push(status);
    }

    // Note: tester_id removed - assignment now tracked in tech_serial_numbers
    if (assignedTo) {
      query += ` AND packer_id = $${paramCount}`;
      paramCount++;
      params.push(assignedTo);
    }

    query += ` ORDER BY ship_by_date ASC`;

    const result = await pool.query(query, params);

    const payload = {
      orders: result.rows,
      count: result.rows.length,
    };
    await setCachedJson('api:orders', cacheLookup, payload, 20, ['orders']);
    return NextResponse.json(payload, { headers: { 'x-cache': 'MISS' } });
  } catch (error: any) {
    console.error('Error in GET /api/orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error.message },
      { status: 500 }
    );
  }
}
