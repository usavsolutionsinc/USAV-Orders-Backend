import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import pool from '@/lib/db';

/**
 * GET /api/sku-catalog/resolve?sku=<rawSku>&platform=<accountSource>
 *
 * Resolves a raw SKU value (which may be the internal canonical SKU OR a
 * marketplace platform_sku) to its canonical catalog row plus every
 * connected marketplace mapping.
 *
 * Resolution chain:
 *   1. exact match against sku_catalog.sku             → canonical found directly
 *   2. else match sku_platform_ids.platform_sku scoped by LOWER(platform)
 *   3. else match sku_platform_ids.platform_sku unscoped (best-effort
 *      fallback when account_source is missing — returns nothing if
 *      multiple catalog rows would match, to avoid silent mis-pairing)
 *
 * Response (shape consumed by SkuIdentity):
 *   { ok: true, resolved: true,  canonicalSku, productTitle, platforms[] }
 *   { ok: true, resolved: false, rawSku }   // when nothing matches
 */
export const GET = withAuth(async (request, ctx) => {
  const url = new URL(request.url);
  const rawSku = (url.searchParams.get('sku') || '').trim();
  const platform = (url.searchParams.get('platform') || '').trim();
  const orgId = ctx.organizationId;

  if (!rawSku) {
    return NextResponse.json({ ok: false, error: 'sku query param required' }, { status: 400 });
  }

  try {
    type CatalogRow = { id: number; sku: string; product_title: string | null };
    const runQuery = <T extends import('pg').QueryResultRow>(sql: string, params: unknown[]) =>
      orgId ? tenantQuery<T>(orgId, sql, params) : pool.query<T>(sql, params);

    // Step 1 — direct match against sku_catalog.sku.
    const directSql = `SELECT id, sku, product_title FROM sku_catalog WHERE sku = $1${orgId ? ' AND organization_id = $2' : ''} LIMIT 1`;
    const direct = await runQuery<CatalogRow>(directSql, orgId ? [rawSku, orgId] : [rawSku]);
    let catalogRow = direct.rows[0];

    // Step 2 — scoped platform lookup.
    if (!catalogRow && platform) {
      const scopedSql = `SELECT sc.id, sc.sku, sc.product_title
           FROM sku_platform_ids spi
           JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id${orgId ? ' AND sc.organization_id = spi.organization_id' : ''}
          WHERE spi.platform_sku = $1
            AND LOWER(spi.platform) = LOWER($2)
            AND spi.sku_catalog_id IS NOT NULL${orgId ? '\n            AND spi.organization_id = $3' : ''}
          LIMIT 2`;
      const scoped = await runQuery<CatalogRow>(
        scopedSql,
        orgId ? [rawSku, platform, orgId] : [rawSku, platform],
      );
      if (scoped.rows.length === 1) catalogRow = scoped.rows[0];
    }

    // Step 3 — unscoped fallback (only if unambiguous).
    if (!catalogRow) {
      const unscopedSql = `SELECT sc.id, sc.sku, sc.product_title
           FROM sku_platform_ids spi
           JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id${orgId ? ' AND sc.organization_id = spi.organization_id' : ''}
          WHERE spi.platform_sku = $1
            AND spi.sku_catalog_id IS NOT NULL${orgId ? '\n            AND spi.organization_id = $2' : ''}
          LIMIT 2`;
      const unscoped = await runQuery<CatalogRow>(unscopedSql, orgId ? [rawSku, orgId] : [rawSku]);
      if (unscoped.rows.length === 1) catalogRow = unscoped.rows[0];
    }

    if (!catalogRow) {
      return NextResponse.json({ ok: true, resolved: false, rawSku });
    }

    // Include both fully-paired rows (sku_catalog_id matches) AND legacy /
    // sync-time rows where only `platform_sku` matches the canonical SKU.
    // The /api/sku-catalog/search route uses the same OR-join so the two
    // endpoints agree on what counts as a linked platform mapping.
    const platformsSql = `SELECT DISTINCT ON (LOWER(platform), COALESCE(platform_sku, ''), COALESCE(platform_item_id, ''))
              platform,
              platform_sku     AS "platformSku",
              platform_item_id AS "platformItemId",
              account_name     AS "accountName"
         FROM sku_platform_ids
        WHERE (sku_catalog_id = $1 OR platform_sku = $2)
          AND is_active = true
          AND (platform_sku IS NOT NULL OR platform_item_id IS NOT NULL)${orgId ? '\n          AND organization_id = $3' : ''}
        ORDER BY LOWER(platform), COALESCE(platform_sku, ''), COALESCE(platform_item_id, ''), platform ASC`;
    const platforms = await runQuery<{
      platform: string;
      platformSku: string | null;
      platformItemId: string | null;
      accountName: string | null;
    }>(platformsSql, orgId ? [catalogRow.id, catalogRow.sku, orgId] : [catalogRow.id, catalogRow.sku]);

    return NextResponse.json({
      ok: true,
      resolved: true,
      canonicalSku: catalogRow.sku,
      productTitle: catalogRow.product_title,
      catalogId: catalogRow.id,
      platforms: platforms.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resolve failed';
    console.error('[GET /api/sku-catalog/resolve] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'orders.view' });
