import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('q') || '').trim();
    const status = String(searchParams.get('status') || '').trim().toLowerCase();
    const limitRaw = Number(searchParams.get('limit') || 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const statusFilter = status === 'unassigned' || status === 'assigned' || status === 'archived' ? status : null;

    if (!query) {
      // Return recent manuals when no query
      const result = await pool.query(
        `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, updated_at
         FROM product_manuals
         WHERE is_active = TRUE
           AND ($2::text IS NULL OR status = $2)
         ORDER BY updated_at DESC
         LIMIT $1`,
        [limit, statusFilter]
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
      `SELECT id, sku, item_number, product_title, display_name, google_file_id, source_url, relative_path, folder_path, file_name, status, assigned_at, assigned_by, type, updated_at
       FROM product_manuals
       WHERE is_active = TRUE
         AND ($4::text IS NULL OR status = $4)
         AND (
           product_title ILIKE $1
           OR display_name ILIKE $1
           OR item_number ILIKE $1
           OR COALESCE(file_name, '') ILIKE $1
           OR COALESCE(relative_path, '') ILIKE $1
           OR COALESCE(source_url, '') ILIKE $1
         )
       ORDER BY
         CASE WHEN LOWER(COALESCE(display_name, product_title, '')) = LOWER($2) THEN 0
              WHEN LOWER(COALESCE(display_name, product_title, '')) LIKE LOWER($3) THEN 1
              ELSE 2
         END,
         updated_at DESC
       LIMIT $5`,
      [pattern, query, `${query.toLowerCase()}%`, statusFilter, limit]
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
    display_name: row.display_name || null,
    google_file_id: String(row.google_file_id || ''),
    source_url: row.source_url || null,
    relative_path: row.relative_path || null,
    folder_path: row.folder_path || null,
    file_name: row.file_name || null,
    status: row.status || 'assigned',
    assigned_at: row.assigned_at || null,
    assigned_by: row.assigned_by || null,
    type: row.type || null,
    updated_at: row.updated_at || null,
  };
}
