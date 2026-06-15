import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/sku-catalog/pair-suggestions?ecwidId=N&limit=5
 *
 * Returns the top-N sku_catalog rows ranked by pg_trgm similarity against the
 * Ecwid row's display_name. Used by the pairing UI to offer click-to-pair
 * suggestions without typing a search.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const ecwidId = Number(searchParams.get('ecwidId'));
    const limit = Math.max(1, Math.min(20, Number(searchParams.get('limit') || 5)));

    if (!ecwidId || Number.isNaN(ecwidId)) {
      return NextResponse.json(
        { success: false, error: 'ecwidId is required' },
        { status: 400 },
      );
    }

    // Look up the ecwid row's display_name — scope to this org so a cross-tenant
    // platform id never leaks a name.
    const ecwid = await tenantQuery(
      ctx.organizationId,
      `SELECT display_name FROM sku_platform_ids
        WHERE id = $1 AND platform = 'ecwid' AND organization_id = $2 LIMIT 1`,
      [ecwidId, ctx.organizationId],
    );
    if (ecwid.rowCount === 0 || !ecwid.rows[0].display_name) {
      return NextResponse.json({ success: true, items: [] });
    }

    const displayName: string = ecwid.rows[0].display_name;

    // Trigram ranking via GIN index. Only return rows with meaningful similarity.
    // Restrict candidates to this org's catalog.
    const result = await tenantQuery(
      ctx.organizationId,
      `SELECT id, sku, product_title, category, image_url,
              ROUND(similarity(product_title, $1)::numeric, 3) AS similarity
         FROM sku_catalog
        WHERE product_title % $1
          AND organization_id = $3
        ORDER BY similarity(product_title, $1) DESC
        LIMIT $2`,
      [displayName, limit, ctx.organizationId],
    );

    return NextResponse.json({
      success: true,
      ecwidDisplayName: displayName,
      items: result.rows,
    });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/pair-suggestions:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch suggestions' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
