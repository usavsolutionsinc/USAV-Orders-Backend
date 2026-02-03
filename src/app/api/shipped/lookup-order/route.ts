import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/shipped/lookup-order?order_id=xxx
 * Lookup order by order_id in shipped table and return product_title
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('order_id');

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Query orders table for matching order_id (shipped orders only)
    // Return product_title
    const result = await pool.query(
      `SELECT product_title
       FROM orders
       WHERE order_id = $1 AND is_shipped = true
       LIMIT 1`,
      [orderId]
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
