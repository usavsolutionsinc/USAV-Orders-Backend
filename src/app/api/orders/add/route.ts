import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { resolveOrCreateSkuCatalogId } from '@/lib/neon/sku-catalog-queries';

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
      sku,
      accountSource,
      status = 'unassigned',
    } = body;

    // Validate required fields
    if (!orderId || !productTitle || !accountSource) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, productTitle, accountSource' },
        { status: 400 }
      );
    }

    // Check if order already exists with this order_id
    const existingOrder = await pool.query(
      `SELECT id, order_id FROM orders WHERE order_id = $1 LIMIT 1`,
      [orderId]
    );

    if (existingOrder.rows.length > 0) {
      return NextResponse.json(
        {
          error: 'Order with this order ID already exists',
          existingOrderId: existingOrder.rows[0].order_id,
        },
        { status: 409 }
      );
    }

    // Resolve or create sku_catalog entry
    const skuCatalogId = await resolveOrCreateSkuCatalogId({
      sku,
      productTitle,
      accountSource,
      orderId,
    });

    // Insert the new order (tracking linked later via shipment_id when packer scans)
    const result = await pool.query(
      `INSERT INTO orders (
        order_id,
        product_title,
        sku,
        account_source,
        status,
        created_at,
        sku_catalog_id
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      RETURNING id, order_id, product_title, sku`,
      [
        orderId,
        productTitle,
        sku || null,
        accountSource,
        status,
        skuCatalogId,
      ]
    );

    await invalidateCacheTags(['orders', 'shipped']);
    await publishOrderChanged({ orderIds: [result.rows[0].id], source: 'orders.add' });
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
