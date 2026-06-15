import { queryOne } from '@/lib/neon-client';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface ResolvedSkuCatalog {
  id: number;
  sku: string;
  product_title: string;
  gtin: string | null;
}

/**
 * Resolve a sku_catalog row for a label/unit operation.
 *
 * Match strategy (shared by the print allocator and the reprint resolver so
 * the same input always lands on the same row):
 *   1. explicit `sku_catalog_id` → direct lookup.
 *   2. exact match on `sku` (case-insensitive, trimmed).
 *   3. leading-zero-stripped match (input "1103" finds catalog "01103").
 *   4. `sku_platform_ids` crosswalk (e.g. a scanned Ecwid SKU that maps to a
 *      different canonical sku_catalog.sku).
 *
 * Returns null when nothing matches.
 */
export async function resolveSkuCatalogRow(
  skuInput: string,
  explicitId?: number | null,
  orgId?: OrgId,
): Promise<ResolvedSkuCatalog | null> {
  if (explicitId != null && Number.isFinite(explicitId) && explicitId > 0) {
    if (orgId) {
      const { rows } = await tenantQuery<ResolvedSkuCatalog>(
        orgId,
        `SELECT id, sku, product_title, gtin FROM sku_catalog
          WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [Math.floor(explicitId), orgId],
      );
      return rows[0] ?? null;
    }
    return await queryOne<ResolvedSkuCatalog>`
      SELECT id, sku, product_title, gtin FROM sku_catalog WHERE id = ${Math.floor(explicitId)} LIMIT 1`;
  }

  const trimmed = String(skuInput ?? '').trim();
  if (!trimmed) return null;

  if (orgId) {
    const { rows } = await tenantQuery<ResolvedSkuCatalog>(
      orgId,
      `SELECT id, sku, product_title, gtin FROM sku_catalog
        WHERE organization_id = $2
          AND (
            UPPER(TRIM(sku)) = UPPER(TRIM($1))
            OR regexp_replace(UPPER(TRIM(sku)), '^0+', '') = regexp_replace(UPPER(TRIM($1)), '^0+', '')
          )
        ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
        LIMIT 1`,
      [trimmed, orgId],
    );
    if (rows[0]) return rows[0];

    // Platform-sku crosswalk fallback (org-scoped on both junction + catalog).
    const { rows: xrows } = await tenantQuery<ResolvedSkuCatalog>(
      orgId,
      `SELECT sc.id, sc.sku, sc.product_title, sc.gtin
         FROM sku_platform_ids sp
         JOIN sku_catalog sc
           ON sc.id = sp.sku_catalog_id
          AND sc.organization_id = sp.organization_id
        WHERE sp.is_active = true
          AND sp.organization_id = $2
          AND (
            UPPER(TRIM(sp.platform_sku)) = UPPER(TRIM($1))
            OR regexp_replace(UPPER(TRIM(COALESCE(sp.platform_sku,''))), '^0+', '') = regexp_replace(UPPER(TRIM($1)), '^0+', '')
          )
        LIMIT 1`,
      [trimmed, orgId],
    );
    return xrows[0] ?? null;
  }

  const row = await queryOne<ResolvedSkuCatalog>`
    SELECT id, sku, product_title, gtin FROM sku_catalog
     WHERE UPPER(TRIM(sku)) = UPPER(TRIM(${trimmed}))
        OR regexp_replace(UPPER(TRIM(sku)), '^0+', '') = regexp_replace(UPPER(TRIM(${trimmed})), '^0+', '')
     ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM(${trimmed}))) DESC
     LIMIT 1`;
  if (row) return row;

  // Platform-sku crosswalk fallback.
  return await queryOne<ResolvedSkuCatalog>`
    SELECT sc.id, sc.sku, sc.product_title, sc.gtin
      FROM sku_platform_ids sp
      JOIN sku_catalog sc ON sc.id = sp.sku_catalog_id
     WHERE sp.is_active = true
       AND (
         UPPER(TRIM(sp.platform_sku)) = UPPER(TRIM(${trimmed}))
         OR regexp_replace(UPPER(TRIM(COALESCE(sp.platform_sku,''))), '^0+', '') = regexp_replace(UPPER(TRIM(${trimmed})), '^0+', '')
       )
     LIMIT 1`;
}
