import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/neon-client';
import { withAuth } from '@/lib/auth/withAuth';
import { allocateNextUnitId } from '@/lib/inventory/unit-id';
import { getOrCreateInternalGtin } from '@/lib/inventory/internal-gtin';
import { buildGs1UnitUrl } from '@/lib/scan-resolver';
import { getAppBaseUrl } from '@/lib/qstash';

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
    // 1. Resolve sku_catalog row.
    const row = explicitId
      ? await queryOne<{ id: number; sku: string; product_title: string; gtin: string | null }>`
          SELECT id, sku, product_title, gtin FROM sku_catalog WHERE id = ${explicitId} LIMIT 1`
      : await queryOne<{ id: number; sku: string; product_title: string; gtin: string | null }>`
          SELECT id, sku, product_title, gtin FROM sku_catalog
           WHERE UPPER(TRIM(sku)) = UPPER(TRIM(${skuInput}))
           LIMIT 1`;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `sku_catalog row not found for "${skuInput || explicitId}"` },
        { status: 404 },
      );
    }

    // 2. Ensure GTIN exists.
    const gtin = row.gtin && row.gtin.trim() ? row.gtin.trim() : await getOrCreateInternalGtin(row.id);

    // 3. Allocate the next unit serial.
    const allocated = await allocateNextUnitId(row.id, row.sku);

    // 4. Build the QR payload URL. Tolerate missing APP_URL in dev by
    //    falling back to a relative path — scan-resolver handles both.
    let qrUrl: string;
    try {
      qrUrl = buildGs1UnitUrl(getAppBaseUrl(), gtin, allocated.unitId);
    } catch {
      qrUrl = buildGs1UnitUrl('', gtin, allocated.unitId);
    }

    return NextResponse.json({
      ok: true,
      unitId: allocated.unitId,
      gtin,
      qrUrl,
      skuCatalogId: row.id,
      sku: row.sku,
      productTitle: row.product_title,
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
