import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { suggestPairingsForSku } from '@/lib/neon/pairing-queries';

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
 * - confirmed = active sku_platform_ids rows whose sku_catalog_id matches OR
 *   whose platform_sku equals sc.sku (legacy unpaired-but-equal rows).
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

async function handle(skuCatalogId: number, perPlatformLimit: number) {
  if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
    return NextResponse.json(
      { success: false, error: 'skuCatalogId is required' },
      { status: 400 },
    );
  }
  const limit = Math.min(Math.max(perPlatformLimit, 1), 20);
  try {
    const snapshot = await suggestPairingsForSku(skuCatalogId, limit);
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
  async (request) => {
    const url = new URL(request.url);
    const skuCatalogId = Number(url.searchParams.get('skuCatalogId') || 0);
    const perPlatformLimit = Number(url.searchParams.get('perPlatformLimit') || 5);
    return handle(skuCatalogId, perPlatformLimit);
  },
  { permission: 'sku_stock.manage' },
);

export const POST = withAuth(
  async (request) => {
    let body: SuggestBody = {};
    try {
      body = (await request.json()) as SuggestBody;
    } catch {
      // empty body is fine — fall through to validation
    }
    return handle(Number(body.skuCatalogId || 0), Number(body.perPlatformLimit || 5));
  },
  { permission: 'sku_stock.manage' },
);
