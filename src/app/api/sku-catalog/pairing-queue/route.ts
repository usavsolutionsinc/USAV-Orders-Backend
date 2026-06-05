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
  // COALESCE the debt columns — they're LEFT JOINed now (a search can surface
  // catalog rows with no suggestions), so they may be NULL. `sc.id` is a stable
  // tiebreaker so paging stays deterministic.
  switch (sort) {
    case 'confidence':
      return 'COALESCE(d.top_confidence, 0) DESC, COALESCE(d.suggestion_count, 0) DESC, sc.product_title ASC, sc.id';
    case 'count':
      return 'COALESCE(d.suggestion_count, 0) DESC, COALESCE(d.top_confidence, 0) DESC, sc.product_title ASC, sc.id';
    case 'title':
      return 'sc.product_title ASC NULLS LAST, sc.sku ASC';
    case 'volume':
    default:
      return 'COALESCE(oc.order_count, 0) DESC, COALESCE(d.top_confidence, 0) DESC, COALESCE(d.suggestion_count, 0) DESC, sc.id';
  }
}

export const GET = withAuth(
  async (request) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const sort = parseSort(url.searchParams.get('sort'));
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 500);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    // ── Search semantics ──────────────────────────────────────────────────────
    // Default (no `q`): show the suggestion backlog — canonical SKUs that carry at
    // least one open pairing suggestion (the "needs review" queue).
    // With `q`: search the FULL active catalog, matching the canonical SKU/title OR
    // any account-source identifier mapped to it via sku_platform_ids
    // (platform_sku / platform_item_id). That lets an operator paste an Amazon
    // ASIN, eBay/Walmart item id, or Ecwid SKU and land on the canonical product —
    // even when it's already paired and has no outstanding suggestion.
    const searching = q.length > 0;

    const params: unknown[] = [];
    let searchClause = '';
    let matchedViaSelect = ', NULL::json AS "matchedVia"';
    if (searching) {
      params.push(`%${q}%`);
      const i = `$${params.length}`;
      // Ecwid's platform_item_id is an internal numeric product id — exclude it
      // from matching so a search only ever hits the meaningful SKU for Ecwid.
      searchClause = `AND (
        sc.sku ILIKE ${i}
        OR sc.product_title ILIKE ${i}
        OR EXISTS (
          SELECT 1 FROM sku_platform_ids sp
           WHERE sp.sku_catalog_id = sc.id
             AND (sp.platform_sku ILIKE ${i}
                  OR (sp.platform <> 'ecwid' AND sp.platform_item_id ILIKE ${i}))
        )
      )`;
      // Surface WHICH platform identifier matched, but only when the hit came from
      // a platform id (a canonical SKU/title match is self-evident from the row).
      matchedViaSelect = `, (
        SELECT json_build_object(
          'platform', sp.platform,
          'platformSku', sp.platform_sku,
          'platformItemId', sp.platform_item_id
        )
        FROM sku_platform_ids sp
        WHERE sp.sku_catalog_id = sc.id
          AND (sp.platform_sku ILIKE ${i}
               OR (sp.platform <> 'ecwid' AND sp.platform_item_id ILIKE ${i}))
          AND NOT (sc.sku ILIKE ${i} OR sc.product_title ILIKE ${i})
        ORDER BY sp.is_active DESC, sp.id
        LIMIT 1
      ) AS "matchedVia"`;
    }
    // The backlog gate only applies to the default (non-search) view.
    const debtGate = searching ? '' : 'AND d.sku_catalog_id IS NOT NULL';
    // ~85% of sku_catalog is is_active=false (inactive Zoho items that are still
    // valid pairing targets). The default backlog stays active-only, but a search
    // must reach inactive rows too — otherwise pasting most ASINs finds nothing.
    // Inactive hits are flagged in the response (`isActive`) so the UI can badge them.
    const activeGate = searching ? '' : 'AND sc.is_active = true';

    const debtCte = `
      debt AS (
        SELECT
          s.sku_catalog_id,
          COUNT(*)::int                    AS suggestion_count,
          MAX(s.confidence)::int           AS top_confidence,
          ARRAY_AGG(DISTINCT sp.platform ORDER BY sp.platform) AS platforms
        FROM sku_pairing_suggestions s
        JOIN sku_platform_ids sp ON sp.id = s.platform_id_row_id
        GROUP BY s.sku_catalog_id
      )`;

    const whereSql = `WHERE TRUE ${activeGate} ${searchClause} ${debtGate}`;

    try {
      const listParams = [...params, limit, offset];
      const limitIdx = `$${listParams.length - 1}`;
      const offsetIdx = `$${listParams.length}`;

      const listSql = `
        WITH ${debtCte}
        SELECT
          sc.id                AS "skuCatalogId",
          sc.sku,
          sc.product_title     AS "productTitle",
          sc.image_url         AS "imageUrl",
          sc.is_active         AS "isActive",
          COALESCE(d.suggestion_count, 0)        AS "suggestionCount",
          COALESCE(d.top_confidence, 0)          AS "topConfidence",
          COALESCE(d.platforms, ARRAY[]::text[]) AS platforms,
          COALESCE(oc.order_count, 0)::int       AS "orderCount",
          (
            SELECT COUNT(*)::int FROM sku_platform_ids sp
             WHERE (sp.sku_catalog_id = sc.id OR sp.platform_sku = sc.sku)
               AND sp.is_active = true
          ) AS "confirmedCount"
          ${matchedViaSelect}
        FROM sku_catalog sc
        LEFT JOIN debt d ON d.sku_catalog_id = sc.id
        LEFT JOIN (
          SELECT sku_catalog_id, COUNT(*)::int AS order_count
            FROM orders
           WHERE sku_catalog_id IS NOT NULL
           GROUP BY sku_catalog_id
        ) oc ON oc.sku_catalog_id = sc.id
        ${whereSql}
        ORDER BY ${orderByClause(sort)}
        LIMIT ${limitIdx} OFFSET ${offsetIdx}
      `;

      const countSql = `
        WITH ${debtCte}
        SELECT COUNT(*)::int AS total
        FROM sku_catalog sc
        LEFT JOIN debt d ON d.sku_catalog_id = sc.id
        ${whereSql}
      `;

      const [listResult, countResult] = await Promise.all([
        pool.query(listSql, listParams),
        pool.query(countSql, params),
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
