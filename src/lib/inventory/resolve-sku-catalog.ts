import { queryOne } from '@/lib/neon-client';

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
): Promise<ResolvedSkuCatalog | null> {
  if (explicitId != null && Number.isFinite(explicitId) && explicitId > 0) {
    return await queryOne<ResolvedSkuCatalog>`
      SELECT id, sku, product_title, gtin FROM sku_catalog WHERE id = ${Math.floor(explicitId)} LIMIT 1`;
  }

  const trimmed = String(skuInput ?? '').trim();
  if (!trimmed) return null;

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
