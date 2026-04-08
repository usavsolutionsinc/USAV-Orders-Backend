import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeSku } from '@/utils/sku';

/**
 * GET /api/sku/lookup?id=123
 * GET /api/sku/lookup?staticSku=PROD or PROD:tag (base segment before ':' is matched)
 *
 * Returns `serial_number`, `static_sku`, and row `id` from the `sku` table for dashboards
 * and tooling that need a direct read without joining packer/tech queries.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get('id');
    const staticRaw = searchParams.get('staticSku') || searchParams.get('code') || '';

    if (idRaw != null && String(idRaw).trim() !== '') {
      const id = Number(idRaw);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      }
      const r = await pool.query(
        `SELECT id, static_sku, serial_number, shipping_tracking_number, notes, location
         FROM sku WHERE id = $1 LIMIT 1`,
        [id],
      );
      const row = r.rows[0];
      if (!row) return NextResponse.json({ error: 'SKU row not found' }, { status: 404 });
      const skuBase = String(row.static_sku || '').trim().split(':')[0].trim();
      const product_url = skuBase ? `https://usavshop.com/products/search?keyword=${encodeURIComponent(skuBase)}` : null;
      return NextResponse.json({ ...row, product_url });
    }

    let base = String(staticRaw).trim();
    if (!base) {
      return NextResponse.json({ error: 'Provide id or staticSku' }, { status: 400 });
    }
    if (base.includes(':')) {
      base = base.split(':')[0].trim();
    }
    const xMatch = base.match(/^(.+?)x(\d+)$/i);
    if (xMatch) base = xMatch[1].trim();

    const normalized = normalizeSku(base);

    let row = (
      await pool.query(
        `SELECT id, static_sku, serial_number, shipping_tracking_number, notes, location
         FROM sku WHERE BTRIM(static_sku) = BTRIM($1) LIMIT 1`,
        [base],
      )
    ).rows[0];

    if (!row) {
      const fuzzy = await pool.query(
        `SELECT id, static_sku, serial_number, shipping_tracking_number, notes, location
         FROM sku WHERE static_sku IS NOT NULL AND BTRIM(static_sku) <> ''`,
      );
      row = fuzzy.rows.find((r: { static_sku?: string }) =>
        normalizeSku(String(r.static_sku || '')) === normalized,
      );
    }

    if (!row) {
      return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
    }

    const skuBase = String(row.static_sku || '').trim().split(':')[0].trim();
    const product_url = skuBase ? `https://usavshop.com/products/search?keyword=${encodeURIComponent(skuBase)}` : null;
    return NextResponse.json({ ...row, product_url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
