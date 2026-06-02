import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

// GET /api/inventory/units
// Paginated serial_units list for the ByFilter view on /inventory.
//
// Query params:
//   state       repeatable / comma-separated — serial_status_enum values
//   condition   repeatable / comma-separated — condition_grade_enum values
//   sku         exact SKU code (case-insensitive)
//   location    exact bin name OR barcode (case-insensitive)
//   q           substring match against serial_number or product_title
//   limit       default 100, max 500
//   offset      default 0
//
// Returns:
//   { items: UnitRow[], total: number, limit, offset }
export const GET = withAuth(async (req: NextRequest) => {
    try {
        const { searchParams } = new URL(req.url);
        const states = readList(searchParams.getAll('state'));
        const conditions = readList(searchParams.getAll('condition'));
        const sku = (searchParams.get('sku') || '').trim();
        const location = (searchParams.get('location') || '').trim();
        const q = (searchParams.get('q') || '').trim();
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 500);
        const offset = Math.max(Number(searchParams.get('offset') || 0), 0);

        const where: string[] = [];
        const params: unknown[] = [];

        if (states.length > 0) {
            params.push(states);
            where.push(`su.current_status::text = ANY($${params.length}::text[])`);
        }
        if (conditions.length > 0) {
            params.push(conditions);
            where.push(`su.condition_grade::text = ANY($${params.length}::text[])`);
        }
        if (sku) {
            params.push(sku);
            where.push(`UPPER(su.sku) = UPPER($${params.length})`);
        }
        if (location) {
            params.push(location);
            where.push(`UPPER(su.current_location) = UPPER($${params.length})`);
        }
        if (q) {
            params.push(`%${q}%`);
            const idx = params.length;
            where.push(`(
                su.serial_number ILIKE $${idx}
                OR COALESCE(sc.product_title, '') ILIKE $${idx}
                OR su.notes ILIKE $${idx}
            )`);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;

        const listSql = `
            SELECT
                su.id,
                su.serial_number,
                su.sku,
                COALESCE(sc.product_title, '') AS product_title,
                su.current_status::text AS current_status,
                su.condition_grade::text AS condition_grade,
                su.current_location,
                su.updated_at
            FROM serial_units su
            LEFT JOIN sku_catalog sc ON sc.id = su.sku_catalog_id OR sc.sku = su.sku
            ${whereClause}
            ORDER BY su.updated_at DESC NULLS LAST, su.id DESC
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        const countSql = `
            SELECT COUNT(*)::int AS total
            FROM serial_units su
            LEFT JOIN sku_catalog sc ON sc.id = su.sku_catalog_id OR sc.sku = su.sku
            ${whereClause}
        `;
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
        const message = error instanceof Error ? error.message : 'Failed to list units';
        console.error('[api/inventory/units] Error:', error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}, { permission: 'sku_stock.view' });

// Accept both repeated `?state=A&state=B` and comma-separated `?state=A,B`.
function readList(rawValues: string[]): string[] {
    const out = new Set<string>();
    for (const v of rawValues) {
        for (const part of v.split(',')) {
            const trimmed = part.trim();
            if (trimmed) out.add(trimmed);
        }
    }
    return Array.from(out);
}
