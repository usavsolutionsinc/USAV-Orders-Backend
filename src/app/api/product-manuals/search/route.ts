import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    if (!query) {
      // Return recent manuals when no query
      const result = await pool.query(
        `SELECT id, sku, item_number, product_title, google_file_id, type, updated_at
         FROM product_manuals
         WHERE is_active = TRUE
         ORDER BY updated_at DESC
         LIMIT $1`,
        [limit]
      );

      return NextResponse.json({
        success: true,
        manuals: result.rows.map(normalizeRow),
        count: result.rows.length,
      });
    }

    // Fuzzy search on product_title using ILIKE for broad matches,
    // plus similarity scoring via pg_trgm when available.
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;

    const result = await pool.query(
      `SELECT id, sku, item_number, product_title, google_file_id, type, updated_at
       FROM product_manuals
       WHERE is_active = TRUE
         AND product_title ILIKE $1
       ORDER BY
         CASE WHEN LOWER(product_title) = LOWER($2) THEN 0
              WHEN LOWER(product_title) LIKE LOWER($3) THEN 1
              ELSE 2
         END,
         updated_at DESC
       LIMIT $4`,
      [pattern, query, `${query.toLowerCase()}%`, limit]
    );

    return NextResponse.json({
      success: true,
      manuals: result.rows.map(normalizeRow),
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error('Error searching product manuals:', error);
    return NextResponse.json(
      { success: false, manuals: [], error: error?.message || 'Failed to search product manuals' },
      { status: 500 }
    );
  }
}

function normalizeRow(row: any) {
  return {
    id: row.id,
    sku: row.sku || null,
    item_number: row.item_number || null,
    product_title: row.product_title || null,
    google_file_id: String(row.google_file_id || ''),
    type: row.type || null,
    updated_at: row.updated_at || null,
  };
}
