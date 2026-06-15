import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { normalizeSku } from '@/utils/sku';
import { parseSerialCsvField } from '@/lib/tech/serialFields';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET ?code=STATICSKU:tag or SKUx2:tag — returns serials from sku row (same matching rules as tech scan-sku).
 */
type SkuSerialsRow = {
  id: number;
  serial_number: string | null;
  notes: string | null;
  static_sku: string | null;
};

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const code = String(new URL(req.url).searchParams.get('code') || '').trim();
    if (!code || !code.includes(':')) {
      return NextResponse.json(
        { success: false, error: 'Use SKU:identifier format (include a colon).' },
        { status: 400 },
      );
    }

    const parts = code.split(':');
    if (parts.length < 2) {
      return NextResponse.json({ success: false, error: 'Invalid SKU:tag format' }, { status: 400 });
    }

    let skuToMatch = parts[0].trim();
    const xMatch = skuToMatch.match(/^(.+?)x(\d+)$/i);
    if (xMatch) {
      skuToMatch = xMatch[1];
    }
    const normalizedSkuToMatch = normalizeSku(skuToMatch);

    // v_sku is a read-only VIEW without an organization_id column, so tenant
    // scope rides on the GUC (RLS on the underlying serial_units rows).
    const exactSku = await tenantQuery<SkuSerialsRow>(
      ctx.organizationId,
      `SELECT id, serial_number, notes, static_sku
       FROM v_sku
       WHERE BTRIM(static_sku) = BTRIM($1)
       LIMIT 1`,
      [skuToMatch],
    );

    let skuRecord: SkuSerialsRow | null = exactSku.rows[0] ?? null;
    if (!skuRecord) {
      const fuzzy = await tenantQuery<SkuSerialsRow>(
        ctx.organizationId,
        `SELECT id, serial_number, notes, static_sku
         FROM v_sku
         WHERE static_sku IS NOT NULL AND BTRIM(static_sku) <> ''`,
      );
      skuRecord =
        fuzzy.rows.find((r) => normalizeSku(String(r.static_sku || '')) === normalizedSkuToMatch) ?? null;
    }

    if (!skuRecord) {
      return NextResponse.json({
        success: false,
        error: `SKU ${skuToMatch} not found in sku table`,
      }, { status: 404 });
    }

    const serials = parseSerialCsvField(skuRecord.serial_number);
    return NextResponse.json({
      success: true,
      serials,
      notes: skuRecord.notes ?? null,
    });
  } catch (e: any) {
    console.error('serials-from-code:', e);
    return NextResponse.json(
      { success: false, error: 'Failed to look up SKU serials', details: e?.message },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
