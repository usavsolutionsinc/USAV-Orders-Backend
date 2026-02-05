import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/add - Add a new order to the system
 * Used by mobile verification screen to add missing orders
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orderId,
      productTitle,
      shippingTrackingNumber,
      sku,
      accountSource,
      status = 'unassigned',
      isShipped = false,
    } = body;

    // Validate required fields
    if (!orderId || !productTitle || !shippingTrackingNumber || !accountSource) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, productTitle, shippingTrackingNumber, accountSource' },
        { status: 400 }
      );
    }

    // Check if order already exists with this tracking number
    const existingOrder = await pool.query(
      `SELECT id FROM orders WHERE shipping_tracking_number = $1`,
      [shippingTrackingNumber]
    );

    if (existingOrder.rows.length > 0) {
      return NextResponse.json(
        { error: 'Order with this tracking number already exists' },
        { status: 409 }
      );
    }

    // Insert the new order
    const result = await pool.query(
      `INSERT INTO orders (
        order_id,
        product_title,
        shipping_tracking_number,
        sku,
        account_source,
        status,
        is_shipped,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, order_id, product_title, shipping_tracking_number`,
      [
        orderId,
        productTitle,
        shippingTrackingNumber,
        sku || null,
        accountSource,
        status,
        isShipped,
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Order added successfully',
      order: result.rows[0],
    });
  } catch (error: any) {
    console.error('Error in POST /api/orders/add:', error);
    return NextResponse.json(
      { error: 'Failed to add order', details: error.message },
      { status: 500 }
    );
  }
}
