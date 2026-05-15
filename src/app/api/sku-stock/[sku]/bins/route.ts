import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getBinLocationsBySku } from '@/lib/neon/location-queries';

/**
 * GET /api/sku-stock/:sku/bins
 *
 * Reverse lookup: given a SKU, return every bin currently holding it.
 * Powers the "where is this product" surface and the SKU detail panel's
 * location section.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const { sku: rawSku } = await params;
    const sku = decodeURIComponent(rawSku || '').trim();
    if (!sku) {
      return NextResponse.json(
        { success: false, error: 'SKU is required' },
        { status: 400 },
      );
    }

    const [bins, totals] = await Promise.all([
      getBinLocationsBySku(sku),
      pool.query<{
        product_title: string | null;
        total_stock: number;
      }>(
        `SELECT
           COALESCE(sp.display_name, sc.product_title, NULLIF(ss.product_title, ''))
             AS product_title,
           COALESCE(ss.stock, 0)::int AS total_stock
         FROM sku_stock ss
         LEFT JOIN sku_catalog sc ON sc.sku = ss.sku
         LEFT JOIN LATERAL (
           SELECT e.display_name
           FROM sku_platform_ids e
           WHERE e.sku_catalog_id = sc.id
             AND e.platform = 'ecwid'
             AND e.is_active = true
             AND e.display_name IS NOT NULL
           LIMIT 1
         ) sp ON TRUE
         WHERE ss.sku = $1
         LIMIT 1`,
        [sku],
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
