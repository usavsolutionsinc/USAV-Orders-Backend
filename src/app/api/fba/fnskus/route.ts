import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { publishFbaCatalogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

// ── POST /api/fba/fnskus ──────────────────────────────────────────────────────
// Add a new FNSKU to the fba_fnskus catalog.
// Body: { fnsku, product_title?, asin?, sku? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const fnsku = String(body?.fnsku || '').trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const product_title = String(body?.product_title || '').trim() || null;
    const asin = String(body?.asin || '').trim().toUpperCase() || null;
    const sku = String(body?.sku || '').trim() || null;

    const result = await pool.query(
      `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, NOW(), NOW())
       ON CONFLICT (fnsku) DO UPDATE
         SET product_title = COALESCE(EXCLUDED.product_title, fba_fnskus.product_title),
             asin          = COALESCE(EXCLUDED.asin, fba_fnskus.asin),
             sku           = COALESCE(EXCLUDED.sku, fba_fnskus.sku),
             is_active     = true,
             updated_at    = NOW()
       RETURNING fnsku, product_title, asin, sku, is_active, created_at`,
      [fnsku, product_title, asin, sku]
    );

    await invalidateCacheTags(['fba-fnskus']);
    await publishFbaCatalogChanged({ action: 'created', fnsku: fnsku || '', source: 'fba.fnskus.create' });

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[POST /api/fba/fnskus]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add FNSKU' },
      { status: 500 }
    );
  }
}
