import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeSku } from '@/utils/sku';
import { parseSerialCsvField } from '@/lib/tech/serialFields';

/**
 * GET ?code=STATICSKU:tag or SKUx2:tag — returns serials from sku row (same matching rules as tech scan-sku).
 */
export async function GET(req: NextRequest) {
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

    const exactSku = await pool.query(
      `SELECT id, serial_number, notes, static_sku
       FROM v_sku
       WHERE BTRIM(static_sku) = BTRIM($1)
       LIMIT 1`,
      [skuToMatch],
    );

    let skuRecord = exactSku.rows[0] ?? null;
    if (!skuRecord) {
      const fuzzy = await pool.query(
        `SELECT id, serial_number, notes, static_sku
         FROM v_sku
         WHERE static_sku IS NOT NULL AND BTRIM(static_sku) <> ''`,
      );
      skuRecord =
        fuzzy.rows.find((r: any) => normalizeSku(String(r.static_sku || '')) === normalizedSkuToMatch) ?? null;
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
}
