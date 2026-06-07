import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseUnitId } from '@/lib/inventory/unit-id';
import { resolveSkuCatalogRow } from '@/lib/inventory/resolve-sku-catalog';
import { getOrCreateInternalGtin } from '@/lib/inventory/internal-gtin';
import { findByUnitUid, findByNormalizedSerial } from '@/lib/neon/serial-units-queries';

export const dynamic = 'force-dynamic';

/**
 * POST /api/units/resolve-id
 *
 * Reprint resolver — the read-only twin of /api/units/next-id. Given an
 * *existing* unit id OR a manufacturer serial (scanned off a label, or read off
 * the device when the label is trashed), it returns the **canonical unit_uid**
 * to reproduce — never minting a new one. That uid is what the reprinted QR
 * encodes, so a reprint is identical to the original.
 *
 *   { unitId: "00098-2621-000142" }  // or a serial like "SN12345"
 *     → { ok, unitId, unitUid, gtin, skuCatalogId, sku, productTitle }
 *
 * Resolution order:
 *   1. serial_units.unit_uid = input (scanned the printed QR / typed the uid).
 *   2. serial_units.normalized_serial = input → return that unit's stored
 *      unit_uid (reprint from just the device serial).
 *   3. Legacy / not-found: parse the base SKU off the input and echo the input
 *      itself as the uid (pre-unit_uid labels still reprint their own string).
 *
 * The products label encodes the bare unit id (no GS1 link), so no qrUrl is
 * returned. Authentication: `print.label` permission.
 */
export const POST = withAuth(async (request) => {
  const body = await request.json().catch(() => ({}));
  const unitId = String(body?.unitId || '').trim();
  if (!unitId) {
    return NextResponse.json({ ok: false, error: 'unitId is required' }, { status: 400 });
  }

  try {
    // 1+2. Direct unit lookup — by minted uid, then by manufacturer serial.
    //      Either resolves the canonical stored uid (the reprint guarantee).
    const unitRow = (await findByUnitUid(unitId)) ?? (await findByNormalizedSerial(unitId));
    const canonicalUid = unitRow?.unit_uid ?? null;

    // 3. Resolve the catalog for title + gtin. Prefer the unit's own sku; else
    //    an explicit override; else the base SKU parsed off the id; else raw.
    const baseSku =
      unitRow?.sku?.trim() ||
      String(body?.sku || '').trim() ||
      parseUnitId(unitId)?.baseSku ||
      unitId;

    const resolved = await resolveSkuCatalogRow(baseSku);
    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: `sku_catalog row not found for "${baseSku}"` },
        { status: 404 },
      );
    }

    const gtin =
      resolved.gtin && resolved.gtin.trim()
        ? resolved.gtin.trim()
        : await getOrCreateInternalGtin(resolved.id);

    return NextResponse.json({
      ok: true,
      unitId,
      // The id the reprint should encode: the stored uid when we have one, else
      // the input itself (legacy labels / pre-unit_uid rows).
      unitUid: canonicalUid ?? unitId,
      gtin,
      skuCatalogId: resolved.id,
      sku: resolved.sku,
      productTitle: resolved.product_title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'resolve-id failed';
    console.error('[POST /api/units/resolve-id] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'print.label' });
