import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { suggestPairingsForSku } from '@/lib/neon/pairing-queries';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * GET  /api/sku-catalog/suggest-pairings?skuCatalogId=123&perPlatformLimit=5
 * POST /api/sku-catalog/suggest-pairings  body: { skuCatalogId, perPlatformLimit? }
 *
 * Returns the Product Hub payload for one canonical SKU:
 *   {
 *     skuCatalogId, canonicalSku, canonicalTitle,
 *     confirmed:    { amazon: [...], ebay: [...], ... },
 *     suggestions:  { amazon: [...], ebay: [...], ... }
 *   }
 *
 * - confirmed = active sku_platform_ids rows explicitly linked to this
 *   sku_catalog_id. A coincidental platform_sku == sc.sku match is NOT treated
 *   as confirmed (that misrepresents unpaired rows as linked).
 * - suggestions = unpaired sku_platform_ids rows ranked by title-similarity +
 *   order-volume + account-source heuristics. NEVER auto-applied; the Hub
 *   collects accepts and POSTs them to /pair-batch.
 *
 * Both verbs supported: GET for the Product Hub initial load (cacheable per
 * request), POST for explicit "Refresh suggestions" clicks.
 */

interface SuggestBody {
  skuCatalogId?: number;
  perPlatformLimit?: number;
}

async function handle(skuCatalogId: number, perPlatformLimit: number, orgId: OrgId) {
  if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
    return NextResponse.json(
      { success: false, error: 'skuCatalogId is required' },
      { status: 400 },
    );
  }
  const limit = Math.min(Math.max(perPlatformLimit, 1), 20);
  try {
    // Thread org so the snapshot is tenant-scoped (canonical SKU lookup +
    // confirmed/suggested platform rows all filter on this org).
    const snapshot = await suggestPairingsForSku(skuCatalogId, limit, orgId);
    return NextResponse.json({ success: true, ...snapshot });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'suggest failed';
    if (message.includes('not found')) {
      return NextResponse.json({ success: false, error: message }, { status: 404 });
    }
    console.error('[suggest-pairings] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = withAuth(
  async (request, ctx) => {
    const url = new URL(request.url);
    const skuCatalogId = Number(url.searchParams.get('skuCatalogId') || 0);
    const perPlatformLimit = Number(url.searchParams.get('perPlatformLimit') || 5);
    return handle(skuCatalogId, perPlatformLimit, ctx.organizationId);
  },
  { permission: 'sku_stock.manage' },
);

export const POST = withAuth(
  async (request, ctx) => {
    let body: SuggestBody = {};
    try {
      body = (await request.json()) as SuggestBody;
    } catch {
      // empty body is fine — fall through to validation
    }
    return handle(Number(body.skuCatalogId || 0), Number(body.perPlatformLimit || 5), ctx.organizationId);
  },
  { permission: 'sku_stock.manage' },
);
