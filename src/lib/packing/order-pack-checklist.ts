/**
 * Order-scoped pack checklist — resolves every line on an order (same order_id)
 * and enriches each with sku_catalog data (photo, BOM, QC flags).
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { getKitParts, getQcChecks } from '@/lib/neon/sku-catalog-queries';
import { evaluateKitReadiness, type PackingEnforcement } from '@/lib/packing/kit-readiness';
import { getPackingEnforcement } from '@/lib/tenancy/settings';
import { getOrganization } from '@/lib/tenancy/organizations';

export interface PackKitPartDto {
  id: number;
  name: string;
  type: string;
  qty: number;
  critical: boolean;
}

export interface PackCheckDto {
  id: number;
  label: string;
  category: string | null;
}

export interface PackChecklistLineDto {
  orderRowId: number;
  sku: string | null;
  skuCatalogId: number | null;
  productTitle: string;
  quantity: number;
  condition: string | null;
  itemNumber: string | null;
  serials: string[];
  catalog: {
    imageUrl: string | null;
    category: string | null;
    upc: string | null;
    ean: string | null;
    packNotes: string | null;
  };
  kitParts: PackKitPartDto[];
  packingChecks: PackCheckDto[];
  qcFlags: PackCheckDto[];
}

export interface OrderPackChecklistResult {
  orderId: string;
  orderRowIds: number[];
  enforcement: PackingEnforcement;
  progress: {
    confirmed: number;
    total: number;
    /**
     * Order-level rollup (Phase 3): how many of this order's lines already
     * have a completed pack scan (a packer_logs row on the line's shipment).
     */
    packedLines: number;
    allRequiredIn: boolean;
    blocked: boolean;
  };
  lines: PackChecklistLineDto[];
}

interface OrderLineRow {
  id: number;
  order_id: string | null;
  product_title: string | null;
  sku: string | null;
  condition: string | null;
  quantity: string | null;
  item_number: string | null;
  sku_catalog_id: number | null;
  shipment_id: number | null;
}

async function resolveCatalogImage(
  orgId: OrgId,
  catalogId: number,
): Promise<string | null> {
  const [catalog, ecwid] = await Promise.all([
    tenantQuery<{ image_url: string | null }>(
      orgId,
      `SELECT image_url FROM sku_catalog WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [catalogId, orgId],
    ),
    tenantQuery<{ image_url: string | null }>(
      orgId,
      `SELECT image_url FROM sku_platform_ids
        WHERE sku_catalog_id = $1 AND organization_id = $2 AND platform = 'ecwid'
          AND image_url IS NOT NULL AND TRIM(image_url) <> ''
        ORDER BY id DESC LIMIT 1`,
      [catalogId, orgId],
    ),
  ]);
  const direct = catalog.rows[0]?.image_url?.trim();
  if (direct) return direct;
  const platform = ecwid.rows[0]?.image_url?.trim();
  return platform || null;
}

async function resolveCatalogIdForLine(
  orgId: OrgId,
  line: OrderLineRow,
): Promise<number | null> {
  if (line.sku_catalog_id != null) return line.sku_catalog_id;
  const sku = line.sku?.trim();
  if (!sku) return null;
  const res = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT id FROM sku_catalog
      WHERE organization_id = $2
        AND (
          UPPER(TRIM(sku)) = UPPER(TRIM($1))
          OR regexp_replace(UPPER(TRIM(sku)), '^0+', '')
             = regexp_replace(UPPER(TRIM($1)), '^0+', '')
        )
      ORDER BY (UPPER(TRIM(sku)) = UPPER(TRIM($1))) DESC
      LIMIT 1`,
    [sku, orgId],
  );
  return res.rows[0]?.id ?? null;
}

async function fetchSerialsForShipment(
  orgId: OrgId,
  shipmentId: number | null,
): Promise<string[]> {
  if (shipmentId == null) return [];
  const res = await tenantQuery<{ serial_number: string }>(
    orgId,
    `SELECT DISTINCT serial_number
       FROM tech_serial_numbers
      WHERE shipment_id = $1 AND organization_id = $2 AND serial_number IS NOT NULL
      ORDER BY serial_number`,
    [shipmentId, orgId],
  );
  return res.rows.map((r) => r.serial_number).filter(Boolean);
}

async function enrichLine(
  orgId: OrgId,
  line: OrderLineRow,
  serials: string[],
): Promise<PackChecklistLineDto> {
  const catalogId = await resolveCatalogIdForLine(orgId, line);
  const condition = line.condition?.trim() || null;

  let catalogMeta = {
    imageUrl: null as string | null,
    category: null as string | null,
    upc: null as string | null,
    ean: null as string | null,
    packNotes: null as string | null,
  };
  let kitParts: PackKitPartDto[] = [];
  let qcFlags: PackCheckDto[] = [];

  if (catalogId != null) {
    const [catalogRow, imageUrl, parts, checks] = await Promise.all([
      tenantQuery<{
        product_title: string | null;
        category: string | null;
        upc: string | null;
        ean: string | null;
        notes: string | null;
      }>(
        orgId,
        `SELECT product_title, category, upc, ean, notes
           FROM sku_catalog WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [catalogId, orgId],
      ),
      resolveCatalogImage(orgId, catalogId),
      getKitParts(catalogId, condition, orgId).catch(() => []),
      getQcChecks(catalogId, null, { publishedOnly: true }, orgId).catch(() => []),
    ]);
    const cat = catalogRow.rows[0];
    catalogMeta = {
      imageUrl: imageUrl,
      category: cat?.category ?? null,
      upc: cat?.upc ?? null,
      ean: cat?.ean ?? null,
      packNotes: cat?.notes ?? null,
    };
    kitParts = parts.map((p) => ({
      id: p.id,
      name: p.component_name,
      type: p.component_type,
      qty: p.qty_required,
      critical: p.is_critical,
    }));
    qcFlags = checks.map((c) => ({
      id: c.id,
      label: c.step_label,
      category: c.category ?? null,
    }));
  }

  return {
    orderRowId: line.id,
    sku: line.sku,
    skuCatalogId: catalogId,
    productTitle: String(line.product_title || '').trim() || line.sku || 'Untitled product',
    quantity: Math.max(1, Number(line.quantity) || 1),
    condition,
    itemNumber: line.item_number,
    serials,
    catalog: catalogMeta,
    kitParts,
    packingChecks: [],
    qcFlags,
  };
}

/**
 * Build the full pack checklist for an order, keyed by one of its line PKs.
 */
export async function getOrderPackChecklist(
  orgId: OrgId,
  orderRowId: number,
): Promise<OrderPackChecklistResult | null> {
  const anchor = await tenantQuery<OrderLineRow>(
    orgId,
    `SELECT id, order_id, product_title, sku, condition, quantity, item_number,
            sku_catalog_id, shipment_id
       FROM orders
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [orderRowId, orgId],
  );
  const anchorRow = anchor.rows[0];
  if (!anchorRow) return null;

  const orderIdKey = String(anchorRow.order_id || '').trim();
  const linesResult = orderIdKey
    ? await tenantQuery<OrderLineRow>(
        orgId,
        `SELECT id, order_id, product_title, sku, condition, quantity, item_number,
                sku_catalog_id, shipment_id
           FROM orders
          WHERE order_id = $1 AND organization_id = $2
          ORDER BY id ASC`,
        [orderIdKey, orgId],
      )
    : anchor;

  const lineRows = linesResult.rows;
  const shipmentId = lineRows[0]?.shipment_id ?? anchorRow.shipment_id ?? null;
  const serials = await fetchSerialsForShipment(orgId, shipmentId);

  const lines = await Promise.all(
    lineRows.map((line) => enrichLine(orgId, line, serials)),
  );

  const org = await getOrganization(orgId);
  const enforcement = org ? getPackingEnforcement(org.settings) : 'advisory';

  const allParts = lines.flatMap((l) => l.kitParts.map((p) => ({ id: p.id, critical: p.critical })));
  const readiness = evaluateKitReadiness(allParts, [], enforcement);

  // Phase 3 rollup: a line counts as packed when a completed pack scan
  // (packer_logs, tracking_type='ORDERS') exists on the line's shipment.
  let packedLines = 0;
  try {
    const packed = await tenantQuery<{ packed: string }>(
      orgId,
      `SELECT COUNT(DISTINCT o.id) AS packed
         FROM orders o
         JOIN packer_logs pl
           ON pl.shipment_id = o.shipment_id
          AND pl.organization_id = o.organization_id
          AND pl.tracking_type = 'ORDERS'
        WHERE o.organization_id = $2
          AND o.shipment_id IS NOT NULL
          AND ${orderIdKey ? 'o.order_id = $1' : 'o.id = $1'}`,
      [orderIdKey || anchorRow.id, orgId],
    );
    packedLines = Math.min(lines.length, Number(packed.rows[0]?.packed ?? 0));
  } catch {
    // Rollup is a sub-resource — degrade to 0, never fail the checklist.
    packedLines = 0;
  }

  return {
    orderId: orderIdKey || String(anchorRow.id),
    orderRowIds: lineRows.map((l) => l.id),
    enforcement,
    progress: {
      confirmed: 0,
      total: lines.length,
      packedLines,
      allRequiredIn: readiness.allRequiredIn,
      blocked: readiness.blocked,
    },
    lines,
  };
}

/** Single-SKU fallback when no order row exists (SKU-only scan). */
export async function getSkuPackChecklist(
  orgId: OrgId,
  sku: string,
  condition?: string | null,
  productTitle?: string | null,
): Promise<OrderPackChecklistResult> {
  const syntheticLine: OrderLineRow = {
    id: 0,
    order_id: null,
    product_title: productTitle ?? null,
    sku,
    condition: condition ?? null,
    quantity: '1',
    item_number: null,
    sku_catalog_id: null,
    shipment_id: null,
  };
  const line = await enrichLine(orgId, syntheticLine, []);
  const org = await getOrganization(orgId);
  const enforcement = org ? getPackingEnforcement(org.settings) : 'advisory';
  const readiness = evaluateKitReadiness(
    line.kitParts.map((p) => ({ id: p.id, critical: p.critical })),
    [],
    enforcement,
  );
  return {
    orderId: '',
    orderRowIds: [],
    enforcement,
    progress: {
      confirmed: 0,
      total: 1,
      packedLines: 0,
      allRequiredIn: readiness.allRequiredIn,
      blocked: readiness.blocked,
    },
    lines: [line],
  };
}
