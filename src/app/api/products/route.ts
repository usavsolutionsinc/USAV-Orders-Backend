import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// GET /api/products
// Paginated list of sku_catalog rows for the Products page.
//
// Query params:
//   q          full-text fragment matched against sku / product_title / upc / gtin
//   category   exact match on sku_catalog.category
//   active     'true' | 'false' | (omitted = both)
//   hasGtin    'true' | 'false' | (omitted = both)
//   hasEcwid   'true' = only rows with an active ecwid platform link
//   limit      default 100, max 500
//   offset     default 0
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const q = (searchParams.get('q') || '').trim();
        const category = (searchParams.get('category') || '').trim();
        const active = searchParams.get('active');
        const hasGtin = searchParams.get('hasGtin');
        const hasEcwid = searchParams.get('hasEcwid') === 'true';
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);
        const offset = Math.max(Number(searchParams.get('offset') || 0), 0);

        const where: string[] = [];
        const params: unknown[] = [];

        if (q) {
            params.push(`%${q}%`);
            const idx = params.length;
            where.push(`(
                sc.sku ILIKE $${idx}
                OR sc.product_title ILIKE $${idx}
                OR sc.upc ILIKE $${idx}
                OR sc.gtin ILIKE $${idx}
            )`);
        }

        if (category) {
            params.push(category);
            where.push(`sc.category = $${params.length}`);
        }

        if (active === 'true') where.push(`sc.is_active = true`);
        else if (active === 'false') where.push(`sc.is_active = false`);

        if (hasGtin === 'true') where.push(`COALESCE(sc.gtin, '') <> ''`);
        else if (hasGtin === 'false') where.push(`COALESCE(sc.gtin, '') = ''`);

        if (hasEcwid) {
            where.push(`EXISTS (
                SELECT 1 FROM sku_platform_ids sp
                WHERE (sp.sku_catalog_id = sc.id OR sp.platform_sku = sc.sku)
                  AND sp.platform = 'ecwid'
                  AND sp.is_active = true
            )`);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;

        const listSql = `
            SELECT
                sc.id,
                sc.sku,
                sc.product_title,
                sc.category,
                sc.gtin,
                sc.upc,
                sc.image_url,
                sc.is_active,
                EXISTS (
                    SELECT 1 FROM sku_platform_ids sp
                    WHERE (sp.sku_catalog_id = sc.id OR sp.platform_sku = sc.sku)
                      AND sp.platform = 'ecwid'
                      AND sp.is_active = true
                ) AS has_ecwid_link
            FROM sku_catalog sc
            ${whereClause}
            ORDER BY sc.product_title ASC NULLS LAST, sc.sku ASC
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        const countSql = `
            SELECT COUNT(*)::int AS total
            FROM sku_catalog sc
            ${whereClause}
        `;

        // Count query reuses the WHERE params but not LIMIT/OFFSET.
        const countParams = params.slice(0, params.length - 2);

        const [listResult, countResult] = await Promise.all([
            pool.query(listSql, params),
            pool.query(countSql, countParams),
        ]);

        return NextResponse.json({
            success: true,
            items: listResult.rows,
            total: countResult.rows[0]?.total ?? 0,
            limit,
            offset,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to list products';
        console.error('[api/products] Error:', error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
