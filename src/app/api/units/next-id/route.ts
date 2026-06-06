import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { allocateNextUnitId } from '@/lib/inventory/unit-id';
import { resolveSkuCatalogRow } from '@/lib/inventory/resolve-sku-catalog';
import { getOrCreateInternalGtin } from '@/lib/inventory/internal-gtin';
import { buildGs1UnitUrl } from '@/lib/scan-resolver';
import { getAppBaseUrl } from '@/lib/qstash';

/**
 * Public GS1 Digital Link host that the printed unit QR encodes.
 * A normal phone-camera scan opens https://usavshop.com/01/{gtin}/21/{unit},
 * which the shop is responsible for redirecting/landing. Override with
 * LABEL_QR_BASE_URL for staging/dev.
 */
const PUBLIC_QR_BASE_URL = (
  process.env.LABEL_QR_BASE_URL ||
  process.env.NEXT_PUBLIC_LABEL_QR_BASE_URL ||
  'https://usavshop.com'
).trim().replace(/\/+$/, '');

export const dynamic = 'force-dynamic';

/**
 * POST /api/units/next-id
 *
 * Issues the next unit identifier for a SKU and returns everything the
 * label printer needs in one round trip:
 *
 *   {
 *     unitId:  "IPH13-128-BLU-2026-000142",
 *     gtin:    "02000000001236",         // 14 digits, internal range
 *     qrUrl:   "https://app.../01/02000000001236/21/IPH13-128-BLU-2026-000142",
 *     skuCatalogId: 123,
 *     year:    2026,
 *     seq:     142
 *   }
 *
 * Resolution order on sku_catalog:
 *   1. If body.sku_catalog_id is provided → use it directly.
 *   2. Else look up by `sku` (case-insensitive, trimmed). 404 if missing.
 *
 * Internal GTIN is generated + persisted lazily on first call per SKU.
 * Unit sequence is allocated atomically via fn_next_unit_seq (Phase 0).
 *
 * Replaces the legacy /api/sku-manager?action=current|increment chain on
 * the print path. Authentication: `print.label` permission (any operator
 * able to print labels can mint unit IDs).
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

    // 2. Ensure GTIN exists.
    const gtin = resolved.gtin && resolved.gtin.trim() ? resolved.gtin.trim() : await getOrCreateInternalGtin(resolved.id);

    // 3. Allocate the next unit serial.
    const allocated = await allocateNextUnitId(resolved.id, resolved.sku);

    // 4. Build the QR payload URL. The printed QR is a GS1 Digital Link
    //    pointing to usavshop.com so a normal phone-camera scan resolves
    //    to the public storefront. Falls back to internal app origin (or
    //    a relative path) only if the public host is unset.
    let qrUrl: string;
    try {
      const origin = PUBLIC_QR_BASE_URL || getAppBaseUrl();
      qrUrl = buildGs1UnitUrl(origin, gtin, allocated.unitId);
    } catch {
      qrUrl = buildGs1UnitUrl('', gtin, allocated.unitId);
    }

    return NextResponse.json({
      ok: true,
      unitId: allocated.unitId,
      gtin,
      qrUrl,
      skuCatalogId: resolved.id,
      sku: resolved.sku,
      productTitle: resolved.product_title,
      year: allocated.year,
      seq: allocated.seq,
      skuShort: allocated.skuShort,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'next-id failed';
    console.error('[POST /api/units/next-id] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'print.label' });
