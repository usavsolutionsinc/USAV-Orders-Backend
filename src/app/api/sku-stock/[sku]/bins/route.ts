import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { getBinLocationsBySku } from '@/lib/neon/location-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';

/**
 * GET /api/sku-stock/:sku/bins
 *
 * Reverse lookup: given a SKU, return every bin currently holding it.
 * Powers the "where is this product" surface and the SKU detail panel's
 * location section.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'sku_stock.view');
    if (gate.denied) return gate.denied;
    const orgId = gate.ctx.organizationId;
    const { sku: rawSku } = await params;
    const sku = decodeURIComponent(rawSku || '').trim();
    if (!sku) {
      return NextResponse.json(
        { success: false, error: 'SKU is required' },
        { status: 400 },
      );
    }

    const [bins, totals] = await Promise.all([
      // location-queries is optional-orgId (Phase 1) — thread the route's org
      // so the bin lookup is tenant-scoped.
      getBinLocationsBySku(sku, orgId),
      // `ss.sku` is a tenant-scoped string key (collides across orgs); filter
      // on org and org-align the sku_catalog string join. The sku_platform_ids
      // LATERAL joins on the integer surrogate PK sc.id (safe bare).
      tenantQuery<{
        product_title: string | null;
        total_stock: number;
      }>(
        orgId,
        `SELECT
           COALESCE(sp.display_name, sc.product_title, NULLIF(ss.product_title, ''))
             AS product_title,
           COALESCE(ss.stock, 0)::int AS total_stock
         FROM sku_stock ss
         LEFT JOIN sku_catalog sc ON sc.sku = ss.sku AND sc.organization_id = ss.organization_id
         LEFT JOIN LATERAL (
           SELECT e.display_name
           FROM sku_platform_ids e
           WHERE e.sku_catalog_id = sc.id
             AND e.platform = 'ecwid'
             AND e.is_active = true
             AND e.display_name IS NOT NULL
           LIMIT 1
         ) sp ON TRUE
         WHERE ss.sku = $1 AND ss.organization_id = $2
         LIMIT 1`,
        [sku, orgId],
      ),
    ]);

    const meta = totals.rows[0] ?? null;

    return NextResponse.json({
      success: true,
      sku,
      product_title: meta?.product_title ?? null,
      total_stock: meta?.total_stock ?? null,
      bins: bins.map((b: any) => ({
        location: {
          id: Number(b.location_id),
          name: String(b.location_name ?? b.name ?? ''),
          room: b.room ?? null,
          rowLabel: b.row_label ?? null,
          colLabel: b.col_label ?? null,
          barcode: b.barcode ?? null,
        },
        qty: Number(b.qty ?? 0),
        minQty: b.min_qty != null ? Number(b.min_qty) : null,
        maxQty: b.max_qty != null ? Number(b.max_qty) : null,
        lastCounted: b.last_counted ? String(b.last_counted) : null,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to look up bins';
    console.error('sku-stock/[sku]/bins GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
