import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// ── PATCH /api/fba/fnskus/[fnsku] ────────────────────────────────────────────
// Update catalog fields for an existing FNSKU.
// Body: { product_title?, asin?, sku? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fnsku: string }> },
) {
  try {
    const { fnsku: rawFnsku } = await params;
    const fnsku = decodeURIComponent(rawFnsku).trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const body = await request.json();
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if ('product_title' in body) {
      sets.push(`product_title = $${idx++}`);
      vals.push(body.product_title ?? null);
    }
    if ('asin' in body) {
      sets.push(`asin = $${idx++}`);
      vals.push(body.asin ? String(body.asin).trim().toUpperCase() : null);
    }
    if ('sku' in body) {
      sets.push(`sku = $${idx++}`);
      vals.push(body.sku ? String(body.sku).trim() : null);
    }
    if ('condition' in body) {
      sets.push(`condition = $${idx++}`);
      vals.push(body.condition ? String(body.condition).trim() : null);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    sets.push(`updated_at = NOW()`);
    vals.push(fnsku);

    const result = await pool.query(
      `UPDATE fba_fnskus SET ${sets.join(', ')} WHERE fnsku = $${idx} RETURNING fnsku, product_title, asin, sku`,
      vals,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[PATCH /api/fba/fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update FNSKU' },
      { status: 500 },
    );
  }
}

// ── GET /api/fba/fnskus/[fnsku] ──────────────────────────────────────────────
// Fetch a single FNSKU record.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fnsku: string }> },
) {
  try {
    const { fnsku: rawFnsku } = await params;
    const fnsku = decodeURIComponent(rawFnsku).trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT fnsku, product_title, asin, sku, is_active, created_at, updated_at FROM fba_fnskus WHERE fnsku = $1`,
      [fnsku],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/fba/fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FNSKU' },
      { status: 500 },
    );
  }
}
