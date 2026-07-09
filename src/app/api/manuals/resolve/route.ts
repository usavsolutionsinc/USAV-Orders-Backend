import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { normalizeIdentifier } from '@/lib/product-manuals';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrSet } from '@/lib/cache/upstash-cache';
import { CACHE_NS, CACHE_TAGS } from '@/lib/cache/tags';

interface ResolvedManuals {
  found: boolean;
  manuals: unknown[];
}

function buildDocUrls(googleFileId: string) {
  return {
    previewUrl: `https://docs.google.com/document/d/${googleFileId}/preview`,
    viewUrl: `https://docs.google.com/document/d/${googleFileId}`,
    downloadUrl: `https://docs.google.com/document/d/${googleFileId}/export?format=pdf`,
  };
}

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const { searchParams } = new URL(req.url);
    const itemNumber = String(searchParams.get('itemNumber') || '');
    const sku = String(searchParams.get('sku') || '');

    const normalizedItemNumber = normalizeIdentifier(itemNumber);

    if (!normalizedItemNumber && !sku.trim()) {
      return NextResponse.json(
        { success: false, found: false, error: 'itemNumber or sku is required' },
        { status: 400 }
      );
    }

    // Cached on the request identifiers (org-scoped). Manuals change only on a
    // product_manuals upsert; the crosswalk changes on catalog/pairing writes —
    // so tag with both and let those writers bust it. Skips even the crosswalk
    // resolve on a cache hit.
    const cacheKey = `${normalizedItemNumber || 'nis'}:${sku.trim().toUpperCase() || 'nsku'}`;
    const resolved = await getOrSet<ResolvedManuals>(
      CACHE_NS.manual,
      orgId,
      cacheKey,
      1800, // 30 min; writes invalidate the tags
      [CACHE_TAGS.productManuals, CACHE_TAGS.skuCatalog],
      async () => {
    // ── Hub-first: resolve through sku_catalog ──────────────────────────────
    // Thread orgId so the crosswalk (sku_catalog / sku_platform_ids) only
    // matches THIS tenant's catalog — otherwise org A could resolve to org B's
    // catalog id and read its hub-linked manual.
    const skuCatalogId = await resolveSkuCatalogId(sku || null, itemNumber || null, null, orgId);

    let rows: any[] = [];
    // Track which branch produced the rows so matchedBy is accurate (the prior
    // `rows === rows` was always true, mislabeling legacy hits as sku_catalog).
    let matchedBy: 'sku_catalog' | 'item_number' = 'item_number';

    if (skuCatalogId) {
      // product_manuals has no organization_id column (child-scoped via
      // sku_catalog); scope this read through the parent catalog row's org and
      // run it GUC-wrapped via tenantQuery.
      const hubResult = await tenantQuery(
        orgId,
        `SELECT
           id,
           item_number,
           product_title,
           display_name,
           google_file_id,
           type,
           updated_at
         FROM product_manuals
         WHERE is_active = TRUE
           AND sku_catalog_id = $1
           AND EXISTS (
             SELECT 1 FROM sku_catalog sc
             WHERE sc.id = product_manuals.sku_catalog_id
               AND sc.organization_id = $2
           )
         ORDER BY updated_at DESC`,
        [skuCatalogId, orgId]
      );
      rows = hubResult.rows;
      if (rows.length > 0) matchedBy = 'sku_catalog';
    }

    // ── Fallback: legacy item_number match for un-migrated records ──────────
    if (rows.length === 0 && normalizedItemNumber) {
      // Legacy path matches by item_number on un-migrated rows that have no
      // sku_catalog_id, so there is no parent to scope through and
      // product_manuals carries no organization_id column. The GUC is INERT for
      // this table (no RLS, no org column), so tenantQuery alone provides ZERO
      // isolation here. To close the cross-tenant read leak we (a) restrict to
      // genuinely-legacy rows (sku_catalog_id IS NULL — hub-linked rows are
      // already org-scoped above and must not leak via the org-blind
      // item_number) and (b) refuse to return a shared item_number whenever that
      // item_number resolves, through THIS org's crosswalk, to a catalog row
      // owned by a DIFFERENT org — i.e. only surface the legacy row when it is
      // either unattributed everywhere or attributable to the caller's org.
      // (NEEDS-COL: full isolation still requires product_manuals to grow an
      // organization_id column + RLS; tracked separately.)
      const fallbackResult = await tenantQuery(
        orgId,
        `SELECT
           pm.id,
           pm.item_number,
           pm.product_title,
           pm.display_name,
           pm.google_file_id,
           pm.type,
           pm.updated_at
         FROM product_manuals pm
         WHERE pm.is_active = TRUE
           AND pm.sku_catalog_id IS NULL
           AND regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '[^A-Z0-9]', '', 'g') = $1
           AND NOT EXISTS (
             SELECT 1
             FROM sku_platform_ids spi
             JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
             WHERE regexp_replace(UPPER(TRIM(COALESCE(spi.platform_item_id, ''))), '[^A-Z0-9]', '', 'g') = $1
               AND sc.organization_id <> $2
           )
         ORDER BY pm.updated_at DESC`,
        [normalizedItemNumber, orgId]
      );
      rows = fallbackResult.rows;
    }

    if (rows.length === 0) {
      return { found: false, manuals: [] };
    }

    const manuals = rows.map((row) => ({
      id: row.id,
      sku: null,
      itemNumber: row.item_number || null,
      productTitle: row.product_title || null,
      displayName: row.display_name || null,
      googleFileId: row.google_file_id,
      type: row.type || null,
      matchedBy,
      updatedAt: row.updated_at,
      ...buildDocUrls(row.google_file_id),
    }));

    return { found: true, manuals };
      },
    );

    return NextResponse.json({ success: true, found: resolved.found, manuals: resolved.manuals });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json(
        {
          success: false,
          found: false,
          error: 'product_manuals table not found. Run migrations first.',
        },
        { status: 500 }
      );
    }

    console.error('Error resolving product manual:', error);
    return NextResponse.json(
      {
        success: false,
        found: false,
        error: 'Failed to resolve manual',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}, { permission: 'sku_stock.view' });
