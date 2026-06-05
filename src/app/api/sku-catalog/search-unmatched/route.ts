import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/search-unmatched?q=<fragment>
 *
 * The "gaps" companion to /pairing-queue. The pairing queue only ever shows
 * canonical sku_catalog rows; this surfaces the two cases where a search finds
 * NO canonical row to land on, so the operator can fix it from the sidebar:
 *
 *   1. unmappedPlatformIds — account-source identifiers (Amazon ASIN, eBay /
 *      Walmart item id, Ecwid SKU) that exist as a sku_platform_ids row but are
 *      not yet linked to any canonical SKU (sku_catalog_id IS NULL). These are
 *      the rows that pairing-queue search can't reach (it joins on
 *      sp.sku_catalog_id = sc.id). e.g. ASIN B01AWLPUAG → row 8110, unmapped.
 *
 *   2. catalogSku.exists — whether the query is already an exact sku_catalog.sku.
 *      When false, the UI offers "add this as a new Zoho SKU" (POST /api/sku-catalog).
 *
 * Read-only. The actual create/pair actions are guarded by sku_stock.manage on
 * their own endpoints.
 */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return NextResponse.json({
      success: true,
      query: q,
      catalogSku: { exists: false },
      unmappedPlatformIds: [],
    });
  }

  try {
    const like = `%${q}%`;

    const [catalog, unmapped] = await Promise.all([
      pool.query(
        `SELECT id, is_active FROM sku_catalog WHERE upper(sku) = upper($1) LIMIT 1`,
        [q],
      ),
      pool.query(
        `SELECT
           sp.id              AS "platformIdRowId",
           sp.platform,
           sp.platform_sku    AS "platformSku",
           sp.platform_item_id AS "platformItemId",
           sp.account_name    AS "accountName",
           (
             SELECT o.product_title
               FROM orders o
              WHERE (sp.platform_item_id IS NOT NULL AND upper(o.item_number) = upper(sp.platform_item_id))
                 OR (sp.platform_sku     IS NOT NULL AND upper(o.sku)         = upper(sp.platform_sku))
              ORDER BY o.created_at DESC NULLS LAST
              LIMIT 1
           ) AS "suggestedTitle",
           (
             SELECT COUNT(*)::int
               FROM orders o
              WHERE o.sku_catalog_id IS NULL
                AND ((sp.platform_item_id IS NOT NULL AND upper(o.item_number) = upper(sp.platform_item_id))
                  OR (sp.platform_sku     IS NOT NULL AND upper(o.sku)         = upper(sp.platform_sku)))
           ) AS "orderCount"
         FROM sku_platform_ids sp
         WHERE sp.sku_catalog_id IS NULL
           AND sp.is_active = true
           AND (sp.platform_sku ILIKE $1
                OR (sp.platform <> 'ecwid' AND sp.platform_item_id ILIKE $1))
         ORDER BY "orderCount" DESC, sp.id
         LIMIT 25`,
        [like],
      ),
    ]);

    const catalogRow = catalog.rows[0];
    return NextResponse.json({
      success: true,
      query: q,
      catalogSku: catalogRow
        ? { exists: true, id: catalogRow.id, isActive: catalogRow.is_active }
        : { exists: false },
      unmappedPlatformIds: unmapped.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'search-unmatched failed';
    console.error('[search-unmatched] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.view' });
