import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { peekNextUnitId } from '@/lib/inventory/unit-id';
import { resolveSkuCatalogRow } from '@/lib/inventory/resolve-sku-catalog';
import { getOrCreateInternalGtin } from '@/lib/inventory/internal-gtin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/units/next-id
 *
 * PREVIEW of the next unit identifier for a SKU — the label printer shows this
 * before the operator commits to printing. It does NOT advance the sequence
 * (fn_peek_unit_seq); the authoritative per-serial allocation happens server-
 * side at print time in /api/post-multi-sn. This makes browsing SKUs free of
 * sequence burn.
 *
 *   {
 *     unitId:  "IPH13-128-BLU-2026-000142",   // the NEXT id that will be issued
 *     gtin:    "02000000001236",              // 14 digits, internal range
 *     skuCatalogId: 123,
 *     year:    2026,
 *     seq:     142
 *   }
 *
 * Resolution order on sku_catalog:
 *   1. If body.sku_catalog_id is provided → use it directly.
 *   2. Else look up by `sku` (case-insensitive, trimmed). 404 if missing.
 *
 * Internal GTIN is generated + persisted lazily on first call per SKU. The
 * printed products label encodes the bare unit id (no GS1 link), so no qrUrl is
 * returned. Authentication: `print.label` permission.
 */
export const POST = withAuth(async (request) => {
  const body = await request.json().catch(() => ({}));
  const skuInput = String(body?.sku || '').trim();
  const skuCatalogIdInput = Number(body?.sku_catalog_id);
  const explicitId =
    Number.isFinite(skuCatalogIdInput) && skuCatalogIdInput > 0
      ? Math.floor(skuCatalogIdInput)
      : null;

  if (!skuInput && !explicitId) {
    return NextResponse.json(
      { ok: false, error: 'sku or sku_catalog_id is required' },
      { status: 400 },
    );
  }

  try {
    // 1. Resolve sku_catalog row. Match strategy mirrors get-title-by-sku:
    //    exact (case/trim) → leading-zero-stripped → platform_sku crosswalk.
    //    Without this, an input like "1103" misses a catalog row stored as
    //    "01103" and the print flow silently 404s.
    const resolved = await resolveSkuCatalogRow(skuInput, explicitId);

    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: `sku_catalog row not found for "${skuInput || explicitId}"` },
        { status: 404 },
      );
    }

    // 2. Ensure GTIN exists (catalog data; not encoded on the products label).
    const gtin = resolved.gtin && resolved.gtin.trim() ? resolved.gtin.trim() : await getOrCreateInternalGtin(resolved.id);

    // 3. Peek the next unit serial — preview only, does NOT advance the
    //    sequence. The real per-serial allocation happens at print time.
    const preview = await peekNextUnitId(resolved.id, resolved.sku);

    return NextResponse.json({
      ok: true,
      unitId: preview.unitId,
      gtin,
      skuCatalogId: resolved.id,
      sku: resolved.sku,
      productTitle: resolved.product_title,
      year: preview.year,
      seq: preview.seq,
      skuShort: preview.skuShort,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'next-id failed';
    console.error('[POST /api/units/next-id] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'print.label' });
