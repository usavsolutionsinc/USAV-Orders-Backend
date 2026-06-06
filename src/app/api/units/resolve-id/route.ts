import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseUnitId } from '@/lib/inventory/unit-id';
import { resolveSkuCatalogRow } from '@/lib/inventory/resolve-sku-catalog';
import { getOrCreateInternalGtin } from '@/lib/inventory/internal-gtin';
import { buildGs1UnitUrl } from '@/lib/scan-resolver';
import { getAppBaseUrl } from '@/lib/qstash';

/**
 * Public GS1 Digital Link host that the printed unit QR encodes. MUST match
 * the value used by /api/units/next-id so a reprint produces a byte-identical
 * DataMatrix to the original label.
 */
const PUBLIC_QR_BASE_URL = (
  process.env.LABEL_QR_BASE_URL ||
  process.env.NEXT_PUBLIC_LABEL_QR_BASE_URL ||
  'https://usavshop.com'
).trim().replace(/\/+$/, '');

export const dynamic = 'force-dynamic';

/**
 * POST /api/units/resolve-id
 *
 * Reprint resolver — the read-only twin of /api/units/next-id. Given an
 * *existing* unit id (scanned off a previously-printed label, e.g.
 * `00098-2621-000142`), it returns the gtin + GS1 Digital Link qrUrl needed to
 * reproduce the **exact same** DataMatrix, WITHOUT allocating a new sequence.
 *
 *   { unitId: "00098-2621-000142" }
 *     → { ok, unitId, gtin, qrUrl, skuCatalogId, sku, productTitle }
 *
 * The base SKU is parsed off the unit id (the trailing `-{YYWW}-{SEQ6}` is
 * stripped) and resolved against sku_catalog with the same matching strategy
 * the allocator uses. Callers may pass an explicit `sku` to override parsing
 * (legacy ids, or reprint-by-sku).
 */
export const POST = withAuth(async (request) => {
  const body = await request.json().catch(() => ({}));
  const unitId = String(body?.unitId || '').trim();
  if (!unitId) {
    return NextResponse.json({ ok: false, error: 'unitId is required' }, { status: 400 });
  }

  // Base SKU: explicit override → parsed from the unit id → the raw input
  // (covers reprint-by-base-sku where there's no YYWW/SEQ suffix).
  const baseSku = String(body?.sku || '').trim() || parseUnitId(unitId)?.baseSku || unitId;

  try {
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

    // Rebuild the QR for the SCANNED unit id — no allocation, no sequence bump.
    let qrUrl: string;
    try {
      const origin = PUBLIC_QR_BASE_URL || getAppBaseUrl();
      qrUrl = buildGs1UnitUrl(origin, gtin, unitId);
    } catch {
      qrUrl = buildGs1UnitUrl('', gtin, unitId);
    }

    return NextResponse.json({
      ok: true,
      unitId,
      gtin,
      qrUrl,
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
