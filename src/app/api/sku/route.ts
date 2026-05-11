import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeSku } from '@/utils/sku';

function getBaseSku(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const beforeColon = raw.split(':')[0]?.trim() || '';
  const withoutQty = beforeColon.replace(/x\d+$/i, '');
  return normalizeSku(withoutQty);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = String(searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '250', 10) || 250, 1), 1000);
    const fuzzyQuery = query.replace(/\s+/g, '%').toLowerCase();
    const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '');

    const params: any[] = [];
    let sql = `
      SELECT
        id,
        static_sku,
        serial_number,
        shipping_tracking_number,
        notes,
        location,
        to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
        to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
      FROM v_sku
    `;

    if (query) {
      params.push(`%${query}%`);
      sql += `
        WHERE COALESCE(static_sku, '') ILIKE $1
           OR COALESCE(serial_number, '') ILIKE $1
           OR COALESCE(shipping_tracking_number, '') ILIKE $1
           OR COALESCE(notes, '') ILIKE $1
           OR COALESCE(location, '') ILIKE $1
      `;
    }

    params.push(limit);
    sql += `
      ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
      LIMIT $${params.length}
    `;

    const [skuResult, titleResult] = await Promise.all([
      pool.query(sql, params),
      pool.query(
        `SELECT
           sc.sku,
           COALESCE(sp.display_name, sc.product_title) AS product_title
         FROM sku_catalog sc
         LEFT JOIN LATERAL (
           SELECT e.display_name
           FROM sku_platform_ids e
           WHERE e.sku_catalog_id = sc.id
             AND e.platform = 'ecwid'
             AND e.is_active = true
             AND e.display_name IS NOT NULL
           LIMIT 1
         ) sp ON TRUE
         WHERE sc.is_active = true`
      ),
    ]);

    const titleByBaseSku = new Map<string, string>();
    for (const row of titleResult.rows) {
      const baseSku = getBaseSku(String(row.sku || ''));
      const title = String(row.product_title || '').trim();
      if (!baseSku || !title) continue;
      titleByBaseSku.set(baseSku, title);
    }

    let rows = skuResult.rows.map((row) => {
      const baseSku = getBaseSku(String(row.static_sku || ''));
      return {
        ...row,
        product_title: titleByBaseSku.get(baseSku) || '',
      };
    });

    if (query) {
      rows = rows.filter((row) => {
        const staticSku = String(row.static_sku || '').toLowerCase();
        const serial = String(row.serial_number || '').toLowerCase();
        const tracking = String(row.shipping_tracking_number || '').toLowerCase();
        const notes = String(row.notes || '').toLowerCase();
        const location = String(row.location || '').toLowerCase();
        const title = String(row.product_title || '').toLowerCase();
        const normalizedTitle = title.replace(/[^a-z0-9]+/g, '');

        return (
          staticSku.includes(query.toLowerCase()) ||
          serial.includes(query.toLowerCase()) ||
          tracking.includes(query.toLowerCase()) ||
          notes.includes(query.toLowerCase()) ||
          location.includes(query.toLowerCase()) ||
          title.includes(query.toLowerCase()) ||
          (fuzzyQuery && title.includes(fuzzyQuery.replace(/%/g, ' ')) === false && fuzzyQuery.split('%').every((part) => !part || title.includes(part))) ||
          (normalizedQuery ? normalizedTitle.includes(normalizedQuery) : false)
        );
      });
    }

    return NextResponse.json({
      rows,
      count: rows.length,
      query,
    });
  } catch (error: any) {
    console.error('Error in GET /api/sku:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SKU records', details: error.message },
      { status: 500 }
    );
  }
}
