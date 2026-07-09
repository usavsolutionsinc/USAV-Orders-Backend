import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getBenchmarkComparison } from '@/lib/operations/benchmarks';
import { getOrSet } from '@/lib/cache/upstash-cache';
import { CACHE_NS, CACHE_TAGS } from '@/lib/cache/tags';

/**
 * GET /api/operations/benchmarks — org-scoped "you vs typical" readout:
 * seeded insight_links benchmarks paired with the org's own actuals from its
 * inventory_events spine (plan §2.5 / Phase 1). Read-only Monitor data;
 * org from ctx, never cross-tenant.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const rawRange = Number(searchParams.get('rangeDays'));
    const rangeDays = Number.isFinite(rawRange) ? Math.max(1, Math.min(365, rawRange)) : 30;
    // Polled ~120s per tab; analytics over the inventory-events spine. Cache 120s
    // org-scoped, keyed by range; order/tech writes bust it.
    const comparison = await getOrSet(
      CACHE_NS.opsDashboard,
      ctx.organizationId,
      `benchmarks:${rangeDays}`,
      120,
      [CACHE_TAGS.orders, CACHE_TAGS.techLogs],
      () => getBenchmarkComparison(ctx.organizationId, rangeDays),
    );
    return NextResponse.json({ success: true, ...comparison });
  } catch (error) {
    console.error('Error in GET /api/operations/benchmarks:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch benchmarks';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'operations.view' });
