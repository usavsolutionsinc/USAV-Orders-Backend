import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── GET /api/fba/fnskus/validate?fnskus=X00XXXXXXX,X00YYYYYYY ─────────────────
// Validates a comma-separated list of FNSKUs against the fba_fnskus table.
// Returns found/not-found status with product metadata for each.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = String(searchParams.get('fnskus') || '').trim();
    if (!raw) {
      return NextResponse.json({ success: true, results: [] });
    }

    // Deduplicate and uppercase
    const fnskus = Array.from(
      new Set(raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
    );

    if (fnskus.length === 0) {
      return NextResponse.json({ success: true, results: [] });
    }
    if (fnskus.length > 200) {
      return NextResponse.json(
        { success: false, error: 'Too many FNSKUs — max 200 per request' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `SELECT
         fnsku,
         product_title,
         asin,
         sku,
         is_active
       FROM fba_fnskus
       WHERE UPPER(TRIM(fnsku)) = ANY($1::text[])`,
      [fnskus]
    );

    const foundMap = new Map(result.rows.map((r) => [r.fnsku.toUpperCase(), r]));

    const results = fnskus.map((fnsku) => {
      const match = foundMap.get(fnsku);
      return {
        fnsku,
        found: !!match,
        product_title: match?.product_title ?? null,
        asin: match?.asin ?? null,
        sku: match?.sku ?? null,
        is_active: match?.is_active ?? null,
      };
    });

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('[GET /api/fba/fnskus/validate]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Validation failed' },
      { status: 500 }
    );
  }
}
