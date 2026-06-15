import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import { normalizeIdentifier } from '@/lib/product-manuals';
import { resolveSkuCatalogId } from '@/lib/neon/sku-catalog-queries';
import { getCurrentUser } from '@/lib/auth/current-user';

function buildDocUrls(googleFileId: string) {
  return {
    previewUrl: `https://docs.google.com/document/d/${googleFileId}/preview`,
    viewUrl: `https://docs.google.com/document/d/${googleFileId}`,
    downloadUrl: `https://docs.google.com/document/d/${googleFileId}/export?format=pdf`,
  };
}

export async function GET(req: NextRequest) {
  try {
    // This route is intentionally ungated (gate: NONE) — keep that behavior.
    // Soft-resolve the org from the session cookie: when a user is present we
    // scope reads to their tenant + GUC-wrap; when truly anonymous (as today)
    // we keep the prior session-less pool.query behavior unchanged.
    const user = await getCurrentUser();
    const orgId = user?.organizationId ?? null;
    const { searchParams } = new URL(req.url);
    const itemNumber = String(searchParams.get('itemNumber') || '');
    const sku = String(searchParams.get('sku') || '');
    const limitParam = Number(searchParams.get('limit') || 3);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 10) : 3;

    const normalizedItemNumber = normalizeIdentifier(itemNumber);

    if (!normalizedItemNumber && !sku.trim()) {
      return NextResponse.json({ success: true, manuals: [] });
    }

    // ── Hub-first: resolve through sku_catalog ──────────────────────────────
    // Thread orgId (when a user is present) so the crosswalk only matches THIS
    // tenant's catalog. When anonymous, orgId is null and the resolver keeps its
    // prior session-less behavior.
    const skuCatalogId = await resolveSkuCatalogId(sku || null, itemNumber || null, null, orgId ?? undefined);

    let rows: any[] = [];

    if (skuCatalogId) {
      // product_manuals has no organization_id column (child-scoped via
      // sku_catalog). When we have an org, scope this read through the parent
      // catalog row's org + GUC-wrap; when anonymous, keep prior behavior.
      const hubResult = orgId
        ? await tenantQuery(
            orgId,
            `SELECT
               id,
               item_number,
               product_title,
               display_name,
               google_file_id,
               type,
               is_active,
               updated_at
             FROM product_manuals
             WHERE sku_catalog_id = $1
               AND EXISTS (
                 SELECT 1 FROM sku_catalog sc
                 WHERE sc.id = product_manuals.sku_catalog_id
                   AND sc.organization_id = $3
               )
             ORDER BY is_active DESC, updated_at DESC
             LIMIT $2`,
            [skuCatalogId, limit, orgId]
          )
        : await pool.query(
            `SELECT
               id,
               item_number,
               product_title,
               display_name,
               google_file_id,
               type,
               is_active,
               updated_at
             FROM product_manuals
             WHERE sku_catalog_id = $1
             ORDER BY is_active DESC, updated_at DESC
             LIMIT $2`,
            [skuCatalogId, limit]
          );
      rows = hubResult.rows;
    }

    // ── Fallback: legacy item_number match for un-migrated records ──────────
    if (rows.length === 0 && normalizedItemNumber) {
      // Legacy item_number path: un-migrated rows have no sku_catalog_id, so
      // there is no parent to scope through and product_manuals carries no
      // organization_id column. The GUC is INERT for this table (no RLS, no org
      // column), so tenantQuery alone provides ZERO isolation. To close the
      // cross-tenant read leak for AUTHENTICATED callers we (a) restrict to
      // genuinely-legacy rows (sku_catalog_id IS NULL — hub-linked rows are
      // already org-scoped above) and (b) refuse to return a shared item_number
      // that resolves, through THIS org's crosswalk, to a DIFFERENT org's
      // catalog row. (NEEDS-COL: full isolation still requires product_manuals
      // to grow an organization_id column + RLS.)
      const fallbackResult = orgId
        ? await tenantQuery(
            orgId,
            `SELECT
               pm.id,
               pm.item_number,
               pm.product_title,
               pm.display_name,
               pm.google_file_id,
               pm.type,
               pm.is_active,
               pm.updated_at
             FROM product_manuals pm
             WHERE pm.sku_catalog_id IS NULL
               AND regexp_replace(UPPER(TRIM(COALESCE(pm.item_number, ''))), '[^A-Z0-9]', '', 'g') = $1
               AND NOT EXISTS (
                 SELECT 1
                 FROM sku_platform_ids spi
                 JOIN sku_catalog sc ON sc.id = spi.sku_catalog_id
                 WHERE regexp_replace(UPPER(TRIM(COALESCE(spi.platform_item_id, ''))), '[^A-Z0-9]', '', 'g') = $1
                   AND sc.organization_id <> $3
               )
             ORDER BY pm.is_active DESC, pm.updated_at DESC
             LIMIT $2`,
            [normalizedItemNumber, limit, orgId]
          )
        // Anonymous/session-less callers (route is intentionally gate: NONE):
        // no org to scope to, so this keeps the prior raw-pool behavior. This
        // path remains a cross-tenant read for shared item_numbers and cannot
        // be fully closed here — it requires either gating the route or an
        // organization_id column on product_manuals (NEEDS-COL).
        : await pool.query(
            `SELECT
               id,
               item_number,
               product_title,
               display_name,
               google_file_id,
               type,
               is_active,
               updated_at
             FROM product_manuals
             WHERE regexp_replace(UPPER(TRIM(COALESCE(item_number, ''))), '[^A-Z0-9]', '', 'g') = $1
             ORDER BY is_active DESC, updated_at DESC
             LIMIT $2`,
            [normalizedItemNumber, limit]
          );
      rows = fallbackResult.rows;
    }

    const manuals = rows.map((row) => ({
      id: row.id as number,
      itemNumber: (row.item_number as string) || null,
      productTitle: (row.product_title as string) || null,
      displayName: (row.display_name as string) || null,
      googleFileId: row.google_file_id as string,
      type: (row.type as string) || null,
      isActive: !!row.is_active,
      updatedAt: row.updated_at as string,
      ...buildDocUrls(row.google_file_id as string),
    }));

    return NextResponse.json({ success: true, manuals });
  } catch (error: any) {
    console.error('Error fetching recent manuals:', error);
    return NextResponse.json(
      { success: false, manuals: [], error: 'Failed to fetch recent manuals', details: error?.message },
      { status: 500 }
    );
  }
}
