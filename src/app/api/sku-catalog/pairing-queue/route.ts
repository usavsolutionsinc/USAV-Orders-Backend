import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/pairing-queue
 *
 * The Product Hub left-rail data source. Returns canonical SKUs ranked by
 * "pairing debt" — i.e. how many unpaired sku_pairing_suggestions reference
 * them, weighted by the highest-confidence candidate.
 *
 * Query params:
 *   q          full-text fragment matched against sku_catalog.sku / product_title
 *   sort       'volume' (default) | 'confidence' | 'count' | 'title'
 *              - volume     = most-ordered canonical SKU first (highest leverage)
 *              - confidence = highest suggestion confidence first (easy wins)
 *              - count      = most suggestions first (deepest pairing backlog)
 *              - title      = alphabetical
 *   limit      default 100, max 500
 *   offset     default 0
 *
 * Response:
 *   {
 *     success, items: [
 *       { skuCatalogId, sku, productTitle, imageUrl,
 *         suggestionCount, topConfidence, orderCount,
 *         confirmedCount,
 *         platforms: ['amazon','ebay',...]  // platforms with at least one suggestion
 *       }
 *     ],
 *     total
 *   }
 *
 * Reads from sku_pairing_suggestions so this query is cheap regardless of
 * how large sku_platform_ids gets — the cron does the expensive work.
 * order_count is a separate aggregate against orders.sku_catalog_id so the
 * "most ordered SKU = highest pairing priority" sort can be the default.
 */

type SortKey = 'volume' | 'confidence' | 'count' | 'title';

function parseSort(raw: string | null): SortKey {
  if (raw === 'confidence') return 'confidence';
  if (raw === 'count') return 'count';
  if (raw === 'title') return 'title';
  return 'volume';
}

function orderByClause(sort: SortKey): string {
  switch (sort) {
    case 'confidence':
      return 'd.top_confidence DESC NULLS LAST, d.suggestion_count DESC, sc.product_title ASC';
    case 'count':
      return 'd.suggestion_count DESC, d.top_confidence DESC NULLS LAST, sc.product_title ASC';
    case 'title':
      return 'sc.product_title ASC NULLS LAST, sc.sku ASC';
    case 'volume':
    default:
      return 'COALESCE(oc.order_count, 0) DESC, d.top_confidence DESC NULLS LAST, d.suggestion_count DESC';
  }
}

export const GET = withAuth(
  async (request) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const sort = parseSort(url.searchParams.get('sort'));
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    const params: unknown[] = [];
    let qClause = '';
    if (q) {
      params.push(`%${q}%`);
      qClause = `AND (sc.sku ILIKE $${params.length} OR sc.product_title ILIKE $${params.length})`;
    }

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    try {
      const listSql = `
        WITH debt AS (
          SELECT
            s.sku_catalog_id,
            COUNT(*)::int                    AS suggestion_count,
            MAX(s.confidence)::int           AS top_confidence,
            ARRAY_AGG(DISTINCT sp.platform ORDER BY sp.platform) AS platforms
          FROM sku_pairing_suggestions s
          JOIN sku_platform_ids sp ON sp.id = s.platform_id_row_id
          GROUP BY s.sku_catalog_id
        )
        SELECT
          sc.id                AS "skuCatalogId",
          sc.sku,
          sc.product_title     AS "productTitle",
          sc.image_url         AS "imageUrl",
          d.suggestion_count   AS "suggestionCount",
          d.top_confidence     AS "topConfidence",
          d.platforms,
          COALESCE(oc.order_count, 0)::int AS "orderCount",
          (
            SELECT COUNT(*)::int FROM sku_platform_ids sp
             WHERE (sp.sku_catalog_id = sc.id OR sp.platform_sku = sc.sku)
               AND sp.is_active = true
          ) AS "confirmedCount"
        FROM debt d
        JOIN sku_catalog sc ON sc.id = d.sku_catalog_id
        LEFT JOIN (
          SELECT sku_catalog_id, COUNT(*)::int AS order_count
            FROM orders
           WHERE sku_catalog_id IS NOT NULL
           GROUP BY sku_catalog_id
        ) oc ON oc.sku_catalog_id = sc.id
        WHERE sc.is_active = true
        ${qClause}
        ORDER BY ${orderByClause(sort)}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const countSql = `
        SELECT COUNT(*)::int AS total
          FROM sku_pairing_suggestions s
          JOIN sku_catalog sc ON sc.id = s.sku_catalog_id
         WHERE sc.is_active = true
         ${qClause ? qClause.replace(/^AND/, 'AND') : ''}
      `;

      const countParams = params.slice(0, params.length - 2);

      const [listResult, countResult] = await Promise.all([
        pool.query(listSql, params),
        pool.query(`SELECT COUNT(DISTINCT s.sku_catalog_id)::int AS total
                      FROM sku_pairing_suggestions s
                      JOIN sku_catalog sc ON sc.id = s.sku_catalog_id
                     WHERE sc.is_active = true ${qClause}`, countParams),
      ]);

      return NextResponse.json({
        success: true,
        items: listResult.rows,
        total: countResult.rows[0]?.total ?? 0,
        limit,
        offset,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'pairing-queue failed';
      console.error('[pairing-queue] error:', err);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  },
  { permission: 'sku_stock.manage' },
);
