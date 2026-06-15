import { NextRequest, NextResponse } from 'next/server';
import { formatPSTTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { resolveOrCreateSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { withTenantTransaction } from '@/lib/tenancy/db';

export interface ShippedFormData {
  order_id: string;
  product_title: string;
  reason: string;
  condition: string;
  sku?: string;
}

/**
 * POST /api/shipped/submit
 * Create a new shipped entry with combined product_title - reason.
 * Tracking is linked separately via shipment_id once the packer scans.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const body: ShippedFormData = await req.json();

    const {
      order_id,
      product_title,
      reason,
      condition,
      sku,
    } = body;

    // Validate required fields
    if (!order_id || !product_title || !reason || !condition) {
      return NextResponse.json(
        { error: 'order_id, product_title, reason, and condition are required', success: false },
        { status: 400 }
      );
    }

    // Combine reason with product_title ([Reason] - [Product Title])
    const finalProductTitle = `${reason} - ${product_title}`;

    // Get current timestamp in MM/DD/YYYY HH:mm:ss format (24-hour) in PST
    const formattedDate = formatPSTTimestamp();

    // Resolve or create sku_catalog entry
    const skuCatalogId = await resolveOrCreateSkuCatalogId({
      sku,
      productTitle: product_title,
      orderId: order_id,
    });

    // Insert the order row (tracking linked later via shipment_id).
    // Stamp organization_id so the new row is owned by the caller's tenant.
    const insertResult = await withTenantTransaction(orgId, (client) =>
      client.query(
        `INSERT INTO orders (order_id, product_title, condition, sku, status, created_at, sku_catalog_id, organization_id)
         VALUES ($1, $2, $3, $4, 'shipped', NOW(), $5, $6)
         RETURNING id`,
        [order_id, finalProductTitle, condition, sku?.trim() || null, skuCatalogId, orgId]
      )
    );
    const insertedId = insertResult.rows[0]?.id ?? null;

    await invalidateCacheTags(['shipped', 'orders']);
    return NextResponse.json({
      success: true,
      message: 'Shipped entry created successfully',
      id: insertedId,
      data: {
        order_id,
        product_title: finalProductTitle,
        condition,
        sku: sku?.trim() || null,
        date_time: formattedDate,
      }
    });
  } catch (error: any) {
    console.error('Error submitting shipped entry:', error);
    return NextResponse.json(
      { error: 'Failed to submit shipped entry', details: error.message, success: false },
      { status: 500 }
    );
  }
}, { permission: 'shipping.mark_shipped' });
