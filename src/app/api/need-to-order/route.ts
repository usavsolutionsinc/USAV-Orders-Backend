import { NextRequest, NextResponse } from 'next/server';
import { listNeedToOrder } from '@/lib/replenishment';
import { withAuth } from '@/lib/auth/withAuth';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const statuses = (searchParams.get('status') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) as any[];
    const page = Number(searchParams.get('page') || '1');
    const limit = Number(searchParams.get('limit') || '50');
    const skuSearch = searchParams.get('sku') || null;
    const sort = searchParams.get('sort') === 'newest' ? 'newest' as const : 'fifo' as const;

    // Tenant isolation: thread the caller's org so listNeedToOrder gates
    // replenishment_requests by rr.organization_id and aligns the
    // item_stock_cache string-key JOIN on org (Phase A shared-module path).
    const payload = await listNeedToOrder({ statuses, page, limit, skuSearch, sort }, ctx.organizationId);
    return NextResponse.json(payload);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch need-to-order list', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}, { permission: 'sku_stock.view' });
