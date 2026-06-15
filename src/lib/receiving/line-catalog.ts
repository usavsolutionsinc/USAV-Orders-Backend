import pool from '@/lib/db';
import {
  resolveSkuCatalogId,
  resolveOrCreateSkuCatalogId,
} from '@/lib/neon/sku-catalog-queries';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

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
  /** Clean Zoho product name (items mirror) — the canonical title SoT, used as
   *  the collision guard instead of the noisy listing-style item_name. */
  zoho_name: string | null;
}

async function loadLine(
  lineId: number,
  orgId?: OrgId,
): Promise<LineRow | null> {
  if (orgId) {
    // Tenant path: scope the receiving_lines row to the org and align the
    // string-key join (zoho_item_id) so a colliding item in another tenant
    // can never supply the title.
    const res = await tenantQuery<LineRow>(
      orgId,
      `SELECT rl.id, rl.sku, rl.item_name, rl.zoho_item_id,
              zi.name AS zoho_name
         FROM receiving_lines rl
         LEFT JOIN items zi
           ON zi.zoho_item_id = rl.zoho_item_id AND zi.status = 'active'
          AND zi.organization_id = rl.organization_id
        WHERE rl.id = $1 AND rl.organization_id = $2
        LIMIT 1`,
      [lineId, orgId],
    );
    return res.rows[0] ?? null;
  }
  const res = await pool.query<LineRow>(
    `SELECT rl.id, rl.sku, rl.item_name, rl.zoho_item_id,
            zi.name AS zoho_name
       FROM receiving_lines rl
       LEFT JOIN items zi
         ON zi.zoho_item_id = rl.zoho_item_id AND zi.status = 'active'
      WHERE rl.id = $1
      LIMIT 1`,
    [lineId],
  );
  return res.rows[0] ?? null;
}

async function firstScannedCatalogId(
  lineId: number,
  orgId?: OrgId,
): Promise<number | null> {
  if (orgId) {
    const res = await tenantQuery<{ sku_catalog_id: number | null }>(
      orgId,
      `SELECT sku_catalog_id
         FROM serial_units
        WHERE origin_receiving_line_id = $1 AND sku_catalog_id IS NOT NULL
          AND organization_id = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [lineId, orgId],
    );
    return res.rows[0]?.sku_catalog_id ?? null;
  }
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
  orgId?: OrgId,
): Promise<LineCatalogResolution | null> {
  const line = await loadLine(lineId, orgId);
  if (!line) return null;

  // Collision guard signal: the clean Zoho product name (items mirror) is the
  // canonical title; fall back to the line's listing-style item_name only when
  // the line has no Zoho item. Using the clean name avoids false rejects on
  // noisy listing titles while still catching cross-namespace collisions
  // (Zoho 00143 Soundbar vs Ecwid 143 UB-20 Wall Mount).
  const guardTitle = line.zoho_name?.trim() || line.item_name;

  const skuCatalogId =
    (await firstScannedCatalogId(lineId, orgId)) ??
    (await resolveSkuCatalogId(line.sku, line.zoho_item_id, guardTitle, orgId));

  return {
    lineId: line.id,
    sku: line.sku,
    itemNumber: line.zoho_item_id,
    // Display title is the Zoho SKU's own title (canonical SoT), not the PO
    // line's listing-style item_name. Falls back only when there's no Zoho item.
    productTitle: line.zoho_name?.trim() || line.item_name,
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
  orgId?: OrgId,
): Promise<LineCatalogResolution | null> {
  const resolved = await resolveLineCatalog(lineId, orgId);
  if (!resolved) return null;
  if (resolved.skuCatalogId != null) return resolved;

  const created = await resolveOrCreateSkuCatalogId({
    sku: resolved.sku,
    itemNumber: resolved.itemNumber,
    productTitle: resolved.productTitle,
    // Zoho line: never bind to / overwrite a colliding marketplace SKU row.
    guardTitle: resolved.productTitle,
  }, orgId);
  return { ...resolved, skuCatalogId: created };
}
