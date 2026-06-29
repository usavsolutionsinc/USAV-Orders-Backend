import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { resolveOrCreateSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * POST /api/orders/add - Add a new order to the system
 * Used by mobile verification screen to add missing orders
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json();
    const {
      orderId,
      productTitle,
      sku,
      accountSource,
      status = 'unassigned',
      saleAmount,
      currency,
    } = body;

    // Validate required fields
    if (!orderId || !productTitle || !accountSource) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, productTitle, accountSource' },
        { status: 400 }
      );
    }

    // sale_amount is optional; when supplied it must be a finite number.
    if (saleAmount != null && !Number.isFinite(Number(saleAmount))) {
      return NextResponse.json(
        { error: 'saleAmount must be a finite number when provided' },
        { status: 400 }
      );
    }
    const saleAmountValue = saleAmount != null ? Number(saleAmount) : null;
    const currencyValue = (typeof currency === 'string' && currency.trim()) || 'USD';

    const orgId = ctx.organizationId ?? USAV_ORG_ID;

    // Check if order already exists with this order_id
    const existingOrder = await tenantQuery(
      orgId,
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
    }, ctx.organizationId);

    // Insert the new order (tracking linked later via shipment_id when packer scans)
    const result = await tenantQuery(
      orgId,
      `INSERT INTO orders (
        order_id,
        product_title,
        sku,
        account_source,
        status,
        created_at,
        sku_catalog_id,
        sale_amount,
        currency,
        organization_id
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9::uuid)
      RETURNING id, order_id, product_title, sku`,
      [
        orderId,
        productTitle,
        sku || null,
        accountSource,
        status,
        skuCatalogId,
        saleAmountValue,
        currencyValue,
        ctx.organizationId,
      ]
    );

    await invalidateCacheTags(['orders', 'shipped']);
    await publishOrderChanged({ organizationId: ctx.organizationId, orderIds: [result.rows[0].id], source: 'orders.add' });
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
}, { permission: 'orders.create' });
