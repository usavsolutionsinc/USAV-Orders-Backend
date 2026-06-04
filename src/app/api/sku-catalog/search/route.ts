import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const ecwidOnly = searchParams.get('ecwidOnly') === 'true';
    const hasQc = searchParams.get('hasQc') === 'true';
    const excludeSkuSuffix = (searchParams.get('excludeSkuSuffix') || '').trim();
    const searchField = (searchParams.get('searchField') || 'ecwid_sku') as
      | 'ecwid_sku'
      | 'zoho_sku'
      | 'title'
      | 'zoho_catalog';
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 100);

    // QC view: restrict to SKUs that have QC checklist items directly linked
    // (qc_check_templates.sku_catalog_id). Searches sku + title regardless of
    // searchField so the QC picker only ever shows products with a checklist.
    if (hasQc) {
      return NextResponse.json(await searchSkusWithQcChecks(q, limit));
    }

    if (searchField === 'ecwid_sku' || searchField === 'title') {
      return NextResponse.json(
        await searchFromPlatform(q, searchField, excludeSkuSuffix, limit),
      );
    }

    // `zoho_catalog`: title + SKU search sourced purely from the Zoho
    // `sku_catalog` (no Ecwid display_name fallback). Used by Local Pickup,
    // which must show canonical Zoho product titles.
    if (searchField === 'zoho_catalog') {
      return NextResponse.json(
        await searchFromZohoCatalog(q, excludeSkuSuffix, limit),
      );
    }

    return NextResponse.json(
      await searchFromCatalog(q, category, ecwidOnly, excludeSkuSuffix, limit),
    );
  } catch (error: any) {
    console.error('[sku-catalog/search] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to search SKU catalog' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

async function searchFromPlatform(
  q: string,
  searchField: 'ecwid_sku' | 'title',
  excludeSkuSuffix: string,
  limit: number,
) {
  const filterClauses: string[] = [
    "sp.platform = 'ecwid'",
    'sp.is_active = true',
  ];
  const params: unknown[] = [];

  if (excludeSkuSuffix) {
    params.push(`%${excludeSkuSuffix}`);
    filterClauses.push(`sp.platform_sku NOT ILIKE $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    const likeIdx = params.length;
    if (searchField === 'title') {
      filterClauses.push(`sp.display_name ILIKE $${likeIdx}`);
    } else {
      filterClauses.push(
        `(sp.platform_sku ILIKE $${likeIdx} OR sp.platform_item_id ILIKE $${likeIdx})`,
      );
    }
  }

  params.push(limit);
  const limitIdx = params.length;

  const orderBy =
    searchField === 'title'
      ? 'sp.display_name ASC NULLS LAST'
      : q
        ? `CASE WHEN UPPER(sp.platform_sku) = UPPER($${params.length + 1}) THEN 0 ELSE 1 END, sp.display_name ASC NULLS LAST`
        : 'sp.display_name ASC NULLS LAST';

  if (searchField === 'ecwid_sku' && q) {
    params.push(q);
  }

  const result = await pool.query(
    `SELECT
       sp.id,
       sp.platform_sku AS sku,
       sc.sku AS zoho_sku,
       COALESCE(sp.display_name, sp.platform_sku) AS product_title,
       sc.category,
       sc.upc,
       sp.image_url,
       true AS is_active,
       json_build_array(
         json_build_object(
           'platform', sp.platform,
           'platform_sku', sp.platform_sku,
           'platform_item_id', sp.platform_item_id,
           'account_name', sp.account_name
         )
       ) AS platform_ids
     FROM sku_platform_ids sp
     LEFT JOIN sku_catalog sc
       ON sc.id = sp.sku_catalog_id OR sc.sku = sp.platform_sku
     WHERE ${filterClauses.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    success: true,
    items: result.rows.map((r) => ({
      ...r,
      platform_ids:
        typeof r.platform_ids === 'string'
          ? JSON.parse(r.platform_ids)
          : r.platform_ids,
    })),
  };
}

/**
 * Zoho-only catalog search sourced straight from the Zoho `items` mirror —
 * the authoritative Zoho Inventory table (synced from /api/v1/items). Returns
 * the Zoho SKU, Zoho name, and `zoho_item_id` so Local Pickup can create a Zoho
 * PO that references real Zoho items (not Ecwid listings). Matches on Zoho SKU
 * OR name; only active items with a SKU appear. Results are tagged with a
 * `zoho` platform chip so there's no Ecwid ambiguity.
 */
async function searchFromZohoCatalog(
  q: string,
  excludeSkuSuffix: string,
  limit: number,
) {
  // INNER JOIN sku_catalog only to borrow its numeric id (the popover keys on a
  // numeric id); titles/SKUs/item_id come from `items` (Zoho source of truth).
  const filterClauses: string[] = [
    "i.status = 'active'",
    "i.sku IS NOT NULL",
    "BTRIM(i.sku) <> ''",
  ];
  const params: unknown[] = [];

  if (excludeSkuSuffix) {
    params.push(`%${excludeSkuSuffix}`);
    filterClauses.push(`BTRIM(i.sku) NOT ILIKE $${params.length}`);
  }

  let exactIdx: number | null = null;
  if (q) {
    params.push(`%${q}%`);
    const likeIdx = params.length;
    params.push(q);
    exactIdx = params.length;
    filterClauses.push(`(i.sku ILIKE $${likeIdx} OR i.name ILIKE $${likeIdx})`);
  }

  params.push(limit);
  const limitIdx = params.length;

  const orderBy = exactIdx
    ? `CASE WHEN UPPER(MAX(BTRIM(i.sku))) = UPPER($${exactIdx}) THEN 0 ELSE 1 END, MAX(i.name) ASC`
    : 'MAX(i.name) ASC';

  const result = await pool.query(
    `SELECT
       sc.id,
       MAX(BTRIM(i.sku))      AS sku,
       MAX(BTRIM(i.sku))      AS zoho_sku,
       MAX(i.name)            AS product_title,
       MAX(i.zoho_item_id)    AS zoho_item_id,
       MAX(sc.category)       AS category,
       MAX(i.upc)             AS upc,
       COALESCE(MAX(i.image_url), MAX(sc.image_url)) AS image_url,
       bool_or(sc.is_active)  AS is_active
     FROM items i
     JOIN sku_catalog sc ON sc.sku = BTRIM(i.sku)
     WHERE ${filterClauses.join(' AND ')}
     GROUP BY sc.id
     ORDER BY ${orderBy}
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    success: true,
    items: result.rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      zoho_sku: r.zoho_sku,
      product_title: r.product_title,
      zoho_item_id: r.zoho_item_id,
      category: r.category,
      upc: r.upc,
      image_url: r.image_url,
      is_active: r.is_active,
      // Tag with the Zoho platform only — these come from the Zoho items mirror.
      platform_ids: [
        {
          platform: 'zoho',
          platform_sku: r.sku,
          platform_item_id: r.zoho_item_id,
          account_name: null,
        },
      ],
    })),
  };
}

/**
 * SKUs that have at least one QC check step directly linked
 * (qc_check_templates.sku_catalog_id = sc.id). Category-scoped templates
 * (sku_catalog_id IS NULL) are intentionally excluded — "linked to the SKU"
 * means a direct link. Image/title prefer the ECWID platform row, matching
 * the rest of the catalog search.
 */
async function searchSkusWithQcChecks(q: string, limit: number) {
  const params: unknown[] = [];
  // No is_active filter here: a SKU that has a checklist should always be
  // manageable from the QC view, even if it's been retired from sale. The
  // EXISTS clause already keeps this to the small, deliberately-curated set of
  // SKUs that have QC steps linked.
  const filterClauses: string[] = [
    'EXISTS (SELECT 1 FROM qc_check_templates qc WHERE qc.sku_catalog_id = sc.id)',
  ];

  let exactIdx: number | null = null;
  if (q) {
    params.push(`%${q}%`);
    const likeIdx = params.length;
    params.push(q);
    exactIdx = params.length;
    filterClauses.push(`(sc.sku ILIKE $${likeIdx} OR sc.product_title ILIKE $${likeIdx})`);
  }

  params.push(limit);
  const limitIdx = params.length;

  const orderBy = exactIdx
    ? `CASE WHEN UPPER(sc.sku) = UPPER($${exactIdx}) THEN 0 ELSE 1 END, sc.product_title ASC`
    : 'sc.product_title ASC';

  const result = await pool.query(
    `SELECT
       sc.id,
       sc.sku,
       sc.sku AS zoho_sku,
       COALESCE(sp_ecwid.display_name, sc.product_title) AS product_title,
       sc.category,
       sc.upc,
       COALESCE(sp_ecwid.image_url, sc.image_url) AS image_url,
       sc.is_active
     FROM sku_catalog sc
     LEFT JOIN LATERAL (
       SELECT image_url, display_name
       FROM sku_platform_ids
       WHERE (sku_catalog_id = sc.id OR platform_sku = sc.sku)
         AND platform = 'ecwid'
         AND is_active = true
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1
     ) sp_ecwid ON TRUE
     WHERE ${filterClauses.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $${limitIdx}`,
    params,
  );

  return { success: true, items: result.rows };
}

async function searchFromCatalog(
  q: string,
  category: string,
  ecwidOnly: boolean,
  excludeSkuSuffix: string,
  limit: number,
) {
  const filterClauses: string[] = ['sc.is_active = true'];
  const params: unknown[] = [];

  if (ecwidOnly) {
    filterClauses.push(
      `EXISTS (
         SELECT 1 FROM sku_platform_ids spx
         WHERE (spx.sku_catalog_id = sc.id OR spx.platform_sku = sc.sku)
           AND spx.platform = 'ecwid'
           AND spx.is_active = true
       )`,
    );
  }

  if (excludeSkuSuffix) {
    params.push(`%${excludeSkuSuffix}`);
    filterClauses.push(`sc.sku NOT ILIKE $${params.length}`);
  }

  let exactIdx: number | null = null;
  if (q) {
    params.push(`%${q}%`);
    const likeIdx = params.length;
    params.push(q);
    exactIdx = params.length;
    filterClauses.push(`sc.sku ILIKE $${likeIdx}`);
  }

  if (category) {
    params.push(category);
    filterClauses.push(`sc.category = $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;

  const orderBy = exactIdx
    ? `CASE WHEN UPPER(sc.sku) = UPPER($${exactIdx}) THEN 0 ELSE 1 END, sc.product_title ASC`
    : 'sc.product_title ASC';

  const result = await pool.query(
    `SELECT
       sc.id,
       sc.sku,
       sc.sku AS zoho_sku,
       COALESCE(sp_ecwid.display_name, sc.product_title) AS product_title,
       sc.category,
       sc.upc,
       COALESCE(sp_ecwid.image_url, sc.image_url) AS image_url,
       sc.is_active,
       COALESCE(
         json_agg(
           json_build_object(
             'platform', sp.platform,
             'platform_sku', sp.platform_sku,
             'platform_item_id', sp.platform_item_id,
             'account_name', sp.account_name
           )
         ) FILTER (WHERE sp.id IS NOT NULL),
         '[]'
       ) AS platform_ids
     FROM sku_catalog sc
     LEFT JOIN sku_platform_ids sp
       ON (sp.sku_catalog_id = sc.id OR sp.platform_sku = sc.sku) AND sp.is_active = true
     LEFT JOIN LATERAL (
       SELECT image_url, display_name
       FROM sku_platform_ids
       WHERE (sku_catalog_id = sc.id OR platform_sku = sc.sku)
         AND platform = 'ecwid'
         AND is_active = true
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1
     ) sp_ecwid ON TRUE
     WHERE ${filterClauses.join(' AND ')}
     GROUP BY sc.id, sp_ecwid.image_url, sp_ecwid.display_name
     ORDER BY ${orderBy}
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    success: true,
    items: result.rows.map((r) => ({
      ...r,
      platform_ids:
        typeof r.platform_ids === 'string'
          ? JSON.parse(r.platform_ids)
          : r.platform_ids,
    })),
  };
}
