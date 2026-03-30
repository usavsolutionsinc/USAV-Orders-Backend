import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── GET /api/fba/fnskus/validate?fnskus=X00XXXXXXX,X00YYYYYYY ─────────────────
// Validates a comma-separated list of FNSKUs against the fba_fnskus table.
// Optional: `persist_missing=1` upserts stub catalog rows for unknown FNSKUs so
// metadata can be filled in later, while still returning them as not ready.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = String(searchParams.get('fnskus') || '').trim();
    const persistMissing = new Set(['1', 'true', 'yes']).has(
      String(searchParams.get('persist_missing') || '').trim().toLowerCase()
    );
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
    const missingFnskus = fnskus.filter((fnsku) => !foundMap.has(fnsku));
    let upsertedStubSet = new Set<string>();

    if (persistMissing && missingFnskus.length > 0) {
      // B0-prefixed FNSKUs are ASINs — populate the asin column on upsert
      const upsertResult = await pool.query(
        `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, is_active, last_seen_at, updated_at)
         SELECT missing.fnsku, NULL,
                CASE WHEN missing.fnsku LIKE 'B0%' THEN missing.fnsku ELSE NULL END,
                NULL, TRUE, NOW(), NOW()
         FROM UNNEST($1::text[]) AS missing(fnsku)
         ON CONFLICT (fnsku) DO UPDATE
           SET is_active = TRUE,
               asin = CASE
                 WHEN fba_fnskus.asin IS NULL AND EXCLUDED.fnsku LIKE 'B0%'
                 THEN EXCLUDED.fnsku ELSE fba_fnskus.asin END,
               last_seen_at = EXCLUDED.last_seen_at,
               updated_at = EXCLUDED.updated_at
         RETURNING fnsku, asin`,
        [missingFnskus]
      );
      const upsertedAsinMap = new Map<string, string | null>();
      for (const row of upsertResult.rows) {
        const key = String(row.fnsku || '').trim().toUpperCase();
        if (key) upsertedAsinMap.set(key, row.asin ?? null);
      }
      upsertedStubSet = new Set(upsertedAsinMap.keys());
    }

    const results = fnskus.map((fnsku) => {
      const match = foundMap.get(fnsku);
      // B0-prefixed FNSKUs are ASINs — use the upserted value if the catalog had none
      const upsertedAsin = upsertedStubSet.has(fnsku) ? (fnsku.startsWith('B0') ? fnsku : null) : null;
      const asin = match?.asin ?? upsertedAsin;
      const hasCatalogMetadata = Boolean(
        match && [match.product_title, match.asin, match.sku].some((value) => String(value || '').trim())
      ) || Boolean(asin);
      const catalogExists = Boolean(match) || upsertedStubSet.has(fnsku);
      return {
        fnsku,
        found: hasCatalogMetadata,
        catalog_exists: catalogExists,
        needs_details: catalogExists && !hasCatalogMetadata,
        upserted_stub: upsertedStubSet.has(fnsku),
        product_title: match?.product_title ?? null,
        asin,
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
