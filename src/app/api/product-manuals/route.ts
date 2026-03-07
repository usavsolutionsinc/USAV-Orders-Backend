import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { upsertProductManual } from '@/lib/product-manuals';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get('limit') || 5000);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 10000) : 5000;

    const result = await pool.query(
      `SELECT id, sku, item_number, product_title, google_file_id, type, updated_at
       FROM product_manuals
       WHERE is_active = TRUE
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );

    const productManuals = result.rows.map((row) => ({
      id: row.id,
      sku: row.sku || null,
      item_number: row.item_number || null,
      product_title: row.product_title || null,
      google_doc_id: row.google_file_id || '',
      type: row.type || null,
      updated_at: row.updated_at || null,
    }));

    return NextResponse.json({ success: true, productManuals, count: productManuals.length });
  } catch (error: any) {
    console.error('Error fetching product manuals:', error);
    return NextResponse.json(
      { success: false, productManuals: [], error: error?.message || 'Failed to fetch product manuals' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const manual = await upsertProductManual({
      sku: String(body?.sku || ''),
      itemNumber: String(body?.itemNumber || body?.item_number || ''),
      productTitle: String(body?.productTitle || body?.product_title || ''),
      googleDocIdOrUrl: String(body?.googleDocId || body?.google_doc_id || body?.googleLinkOrFileId || ''),
      type: body?.type,
    });

    return NextResponse.json({ success: true, manual }, { status: 201 });
  } catch (error: any) {
    const message = error?.message || 'Failed to save product manual';
    const status = /required|valid/i.test(message) ? 400 : 500;

    console.error('Error saving product manual:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
