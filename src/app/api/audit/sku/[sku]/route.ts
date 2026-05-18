import { NextRequest, NextResponse } from 'next/server';
import { getSkuAuditHistory } from '@/lib/audit-log/entity-history';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit/sku/[sku]?limit=200
 *
 * Per-SKU audit timeline. Newest-first union of audit_logs (field diffs),
 * inventory_events (lifecycle), and sku_stock_ledger (qty deltas).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'admin.view_logs');
    if (gate.denied) return gate.denied;
    const { sku } = await params;
    const skuValue = decodeURIComponent(sku || '').trim();
    if (!skuValue) {
      return NextResponse.json({ error: 'SKU is required' }, { status: 400 });
    }
    const limitParam = Number(req.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 200;
    const events = await getSkuAuditHistory(skuValue, { limit });
    return NextResponse.json({ success: true, sku: skuValue, events });
  } catch (err: any) {
    console.error('[GET /api/audit/sku/[sku]] error:', err);
    return NextResponse.json(
      { error: 'Failed to load SKU audit', details: err?.message },
      { status: 500 },
    );
  }
}
