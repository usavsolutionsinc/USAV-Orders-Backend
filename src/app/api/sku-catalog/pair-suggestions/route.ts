import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/pair-suggestions?ecwidId=N&limit=5
 *
 * Returns the top-N sku_catalog rows ranked by pg_trgm similarity against the
 * Ecwid row's display_name. Used by the pairing UI to offer click-to-pair
 * suggestions without typing a search.
 */
export async function GET(req: NextRequest) {
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

    // Look up the ecwid row's display_name
    const ecwid = await pool.query(
      `SELECT display_name FROM sku_platform_ids WHERE id = $1 AND platform = 'ecwid' LIMIT 1`,
      [ecwidId],
    );
    if (ecwid.rowCount === 0 || !ecwid.rows[0].display_name) {
      return NextResponse.json({ success: true, items: [] });
    }

    const displayName: string = ecwid.rows[0].display_name;

    // Trigram ranking via GIN index. Only return rows with meaningful similarity.
    const result = await pool.query(
      `SELECT id, sku, product_title, category, image_url,
              ROUND(similarity(product_title, $1)::numeric, 3) AS similarity
         FROM sku_catalog
        WHERE product_title % $1
        ORDER BY similarity(product_title, $1) DESC
        LIMIT $2`,
      [displayName, limit],
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
}
