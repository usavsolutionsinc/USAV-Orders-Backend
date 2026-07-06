import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getOrderPackChecklist,
  getSkuPackChecklist,
} from '@/lib/packing/order-pack-checklist';

/**
 * GET /api/orders/[id]/pack-checklist
 *
 * Returns every line on the order (same order_id) enriched with sku_catalog
 * photo, kit-parts BOM, and QC verify steps for the packer checklist.
 *
 * Path `[id]` is orders.id (numeric PK). For SKU-only scans with no order row,
 * pass `?sku=` (and optional `?condition=`, `?title=`) with id=0.
 */
export const GET = withAuth(async (request: NextRequest, ctx) => {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const idStr = segments[segments.length - 2];
  const orderRowId = Number(idStr);

  const { searchParams } = request.nextUrl;
  const skuParam = searchParams.get('sku')?.trim();

  if ((!Number.isFinite(orderRowId) || orderRowId <= 0) && skuParam) {
    const condition = searchParams.get('condition');
    const title = searchParams.get('title');
    const result = await getSkuPackChecklist(
      ctx.organizationId,
      skuParam,
      condition,
      title,
    );
    return NextResponse.json({ success: true, ...result });
  }

  if (!Number.isFinite(orderRowId) || orderRowId <= 0) {
    return NextResponse.json({ success: false, error: 'invalid order id' }, { status: 400 });
  }

  const result = await getOrderPackChecklist(ctx.organizationId, orderRowId);
  if (!result) {
    return NextResponse.json({ success: false, error: 'order not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, ...result });
}, { permission: 'sku_stock.view' });
