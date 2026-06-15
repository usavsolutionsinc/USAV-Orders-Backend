import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/sku-catalog/suggest-for-item?title=...&limit=5
 *
 * Reverse of /suggest-pairings: given an UNPAIRED order item's product title,
 * suggest the catalog SKUs it most likely belongs to. Powers the "Suggested
 * matches" rows in the manuals SkuPairingPanel so operators get one-click
 * pairing instead of searching the catalog by hand (roadmap C5).
 *
 * The order item → catalog direction isn't modeled in sku_pairing_suggestions
 * (that table is catalog ↔ platform-listing), so we score on the fly using the
 * SAME pg_trgm title-similarity formula the nightly suggestion cron uses
 * (`refreshAllSuggestions`): confidence = round(similarity * 85), display floor
 * 40. Read-only — the operator still confirms before any pairing is written.
 */

interface SuggestionRow {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
  confidence: number;
  sim: string;
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const title = (searchParams.get('title') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 5), 1), 20);

    // No title to match against → nothing to suggest (not an error).
    if (!title) {
      return NextResponse.json({ success: true, suggestions: [] });
    }

    const { rows } = await tenantQuery<SuggestionRow>(
      ctx.organizationId,
      `SELECT id, sku, product_title, category, image_url, confidence, sim
         FROM (
           SELECT id, sku, product_title, category, image_url,
                  LEAST(95, GREATEST(0, ROUND(similarity(product_title, $1) * 85)::int)) AS confidence,
                  ROUND(similarity(product_title, $1)::numeric, 2)::text AS sim
             FROM sku_catalog
            WHERE is_active = true
              AND organization_id = $3
              AND product_title % $1
         ) s
        WHERE s.confidence >= 40
        ORDER BY s.confidence DESC, s.product_title
        LIMIT $2`,
      [title, limit, ctx.organizationId],
    );

    return NextResponse.json({
      success: true,
      suggestions: rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        product_title: r.product_title,
        category: r.category,
        image_url: r.image_url,
        confidence: r.confidence,
        reason: `trigram_${r.sim}`,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to suggest matches';
    console.error('[sku-catalog/suggest-for-item] Error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.view' });
