import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

type Params = Promise<{ fnsku: string }>;

// ── GET /api/admin/fba-fnskus/[fnsku] ────────────────────────────────────────
// Returns a single FNSKU record.
export async function GET(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { fnsku } = await params;
    const normalizedFnsku = String(fnsku || '').trim().toUpperCase();
    if (!normalizedFnsku) {
      return NextResponse.json({ success: false, error: 'FNSKU is required' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT fnsku, product_title, asin, sku, is_active, last_seen_at, created_at, updated_at
       FROM fba_fnskus
       WHERE fnsku = $1`,
      [normalizedFnsku]
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/admin/fba-fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FNSKU' },
      { status: 500 }
    );
  }
}

// ── PATCH /api/admin/fba-fnskus/[fnsku] ──────────────────────────────────────
// Update mutable metadata on an FNSKU.
// Body (all optional): { product_title, asin, sku, is_active }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { fnsku } = await params;
    const normalizedFnsku = String(fnsku || '').trim().toUpperCase();
    if (!normalizedFnsku) {
      return NextResponse.json({ success: false, error: 'FNSKU is required' }, { status: 400 });
    }

    const body = await request.json();

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const setField = (col: string, val: unknown) => {
      fields.push(`${col} = $${idx++}`);
      values.push(val);
    };

    if ('product_title' in body) setField('product_title', body.product_title || null);
    if ('asin' in body) setField('asin', String(body.asin || '').trim().toUpperCase() || null);
    if ('sku' in body) setField('sku', body.sku || null);
    if ('is_active' in body) setField('is_active', Boolean(body.is_active));

    if (fields.length === 0) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    fields.push(`updated_at = NOW()`);
    values.push(normalizedFnsku);

    const result = await pool.query(
      `UPDATE fba_fnskus
       SET ${fields.join(', ')}
       WHERE fnsku = $${idx}
       RETURNING *`,
      values
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[PATCH /api/admin/fba-fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update FNSKU' },
      { status: 500 }
    );
  }
}

// ── DELETE /api/admin/fba-fnskus/[fnsku] ─────────────────────────────────────
// Soft-deactivate an FNSKU (sets is_active = false).
// Hard delete is intentionally blocked because fba_shipment_items and
// fba_fnsku_logs reference this table via FK.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { fnsku } = await params;
    const normalizedFnsku = String(fnsku || '').trim().toUpperCase();
    if (!normalizedFnsku) {
      return NextResponse.json({ success: false, error: 'FNSKU is required' }, { status: 400 });
    }

    const result = await pool.query(
      `UPDATE fba_fnskus
       SET is_active = FALSE, updated_at = NOW()
       WHERE fnsku = $1
       RETURNING fnsku, is_active, updated_at`,
      [normalizedFnsku]
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `FNSKU ${normalizedFnsku} has been deactivated`,
      fnsku: result.rows[0],
    });
  } catch (error: any) {
    console.error('[DELETE /api/admin/fba-fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to deactivate FNSKU' },
      { status: 500 }
    );
  }
}
