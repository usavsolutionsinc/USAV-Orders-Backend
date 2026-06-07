import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/sku-catalog/[id]/similar — same-category sibling SKUs.
 *
 * "Similar products" has no dedicated relationship table, so we derive it on
 * demand: other catalog rows that share this SKU's `category` (excluding
 * itself), ordered by on-hand stock then title. Lightweight, no stored data.
 * Returns an empty list when the SKU has no category — the caller renders a
 * graceful empty state rather than guessing.
 *
 * `id` is a sku_catalog.id (integer).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'sku_stock.view');
    if (gate.denied) return gate.denied;

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 12), 1), 50);

    const self = await pool.query<{ category: string | null }>(
      `SELECT category FROM sku_catalog WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (self.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }
    const category = self.rows[0].category?.trim() || null;
    if (!category) {
      return NextResponse.json({ success: true, category: null, items: [] });
    }

    const result = await pool.query(
      `SELECT sc.id        AS sku_id,
              sc.sku,
              sc.product_title,
              sc.category,
              sc.image_url,
              COALESCE(ss.stock, 0)       AS stock,
              COALESCE(ss.boxed_stock, 0) AS boxed_stock
         FROM sku_catalog sc
         LEFT JOIN sku_stock ss ON ss.sku = sc.sku
        WHERE sc.category = $1
          AND sc.id <> $2
        ORDER BY COALESCE(ss.stock, 0) DESC, sc.product_title ASC
        LIMIT $3`,
      [category, id, limit],
    );

    return NextResponse.json({ success: true, category, items: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load similar products';
    console.error('sku-catalog/[id]/similar GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
