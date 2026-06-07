import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { getQcChecks } from '@/lib/neon/sku-catalog-queries';
import { resolveLineCatalog } from '@/lib/receiving/line-catalog';

/**
 * GET /api/receiving-lines/[id]/testing-bundle
 *
 * Everything the tech testing panel needs for one receiving line, keyed by the
 * sku_catalog row resolved from the line (scanned unit → SKU string → Zoho item
 * crosswalk). Returns the checklist *template* steps and the SKU's paired
 * manuals (Vercel Blob `source_url`). Per-unit checklist results are loaded
 * separately via /api/serial-units/[id]/checklist once a serial is scanned.
 *
 * `skuCatalogId: null` means the SKU has no catalog row yet — the panel shows a
 * "create catalog entry" action that hits the qc-checks POST (create-on-demand).
 */
function lineIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  // .../api/receiving-lines/[id]/testing-bundle → id is segments[-2]
  return Number(segments[segments.length - 2]);
}

export const GET = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }

  try {
    const resolved = await resolveLineCatalog(lineId);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: 'line not found' }, { status: 404 });
    }

    if (resolved.skuCatalogId == null) {
      return NextResponse.json({
        ok: true,
        skuCatalogId: null,
        sku: resolved.sku,
        title: resolved.productTitle,
        checklist: [],
        manuals: [],
      });
    }

    const cat = await pool.query<{ category: string | null; product_title: string | null }>(
      `SELECT category, product_title FROM sku_catalog WHERE id = $1`,
      [resolved.skuCatalogId],
    );
    const category = cat.rows[0]?.category ?? null;

    const [checklist, manuals] = await Promise.all([
      // Execution view — only published steps reach the tech.
      getQcChecks(resolved.skuCatalogId, category, { publishedOnly: true }),
      pool.query(
        `SELECT id, display_name, type, source_url, thumbnail_url, file_name
           FROM product_manuals
          WHERE sku_catalog_id = $1 AND is_active = true
          ORDER BY updated_at DESC`,
        [resolved.skuCatalogId],
      ),
    ]);

    return NextResponse.json({
      ok: true,
      skuCatalogId: resolved.skuCatalogId,
      sku: resolved.sku,
      title: cat.rows[0]?.product_title ?? resolved.productTitle,
      checklist: checklist.map((c) => ({
        step_id: c.id,
        step_label: c.step_label,
        step_type: c.step_type,
        sort_order: c.sort_order,
        value_kind: c.value_kind ?? null,
        value_unit: c.value_unit ?? null,
        value_enum: c.value_enum ?? null,
        pass_min: c.pass_min ?? null,
        pass_max: c.pass_max ?? null,
      })),
      manuals: manuals.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load testing bundle';
    console.error('[GET /api/receiving-lines/[id]/testing-bundle] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
