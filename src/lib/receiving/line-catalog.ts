import pool from '@/lib/db';
import {
  resolveSkuCatalogId,
  resolveOrCreateSkuCatalogId,
} from '@/lib/neon/sku-catalog-queries';

/**
 * Resolve the sku_catalog row a receiving line maps to.
 *
 * The line itself only carries a `sku` string (`receiving_lines.sku_catalog_id`
 * exists but is never populated). The authoritative, populated linkage is
 * `serial_units.sku_catalog_id`, set at scan time (see receive-line.ts). So we
 * prefer a scanned unit's catalog id and fall back to resolving from the SKU
 * string / Zoho item number — this lets the testing panel show the checklist
 * and manuals *before* any serial is scanned.
 */
export interface LineCatalogResolution {
  lineId: number;
  sku: string | null;
  itemNumber: string | null;
  productTitle: string | null;
  skuCatalogId: number | null;
}

interface LineRow {
  id: number;
  sku: string | null;
  item_name: string | null;
  zoho_item_id: string | null;
}

async function loadLine(lineId: number): Promise<LineRow | null> {
  const res = await pool.query<LineRow>(
    `SELECT id, sku, item_name, zoho_item_id FROM receiving_lines WHERE id = $1 LIMIT 1`,
    [lineId],
  );
  return res.rows[0] ?? null;
}

async function firstScannedCatalogId(lineId: number): Promise<number | null> {
  const res = await pool.query<{ sku_catalog_id: number | null }>(
    `SELECT sku_catalog_id
       FROM serial_units
      WHERE origin_receiving_line_id = $1 AND sku_catalog_id IS NOT NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [lineId],
  );
  return res.rows[0]?.sku_catalog_id ?? null;
}

/**
 * Read-only resolution. Returns `skuCatalogId: null` when the SKU has no
 * catalog row yet (caller can offer a "create catalog entry" action). Returns
 * `null` entirely when the line id doesn't exist.
 */
export async function resolveLineCatalog(
  lineId: number,
): Promise<LineCatalogResolution | null> {
  const line = await loadLine(lineId);
  if (!line) return null;

  const skuCatalogId =
    (await firstScannedCatalogId(lineId)) ??
    (await resolveSkuCatalogId(line.sku, line.zoho_item_id));

  return {
    lineId: line.id,
    sku: line.sku,
    itemNumber: line.zoho_item_id,
    productTitle: line.item_name,
    skuCatalogId,
  };
}

/**
 * Like {@link resolveLineCatalog} but creates the catalog row on demand when it
 * can't be resolved (used by tech-initiated mutations that need a catalog id to
 * attach to — checklist steps, manual pairing). Returns `null` only when the
 * line doesn't exist or there's no SKU to key on.
 */
export async function resolveOrCreateLineCatalog(
  lineId: number,
): Promise<LineCatalogResolution | null> {
  const resolved = await resolveLineCatalog(lineId);
  if (!resolved) return null;
  if (resolved.skuCatalogId != null) return resolved;

  const created = await resolveOrCreateSkuCatalogId({
    sku: resolved.sku,
    itemNumber: resolved.itemNumber,
    productTitle: resolved.productTitle,
  });
  return { ...resolved, skuCatalogId: created };
}
