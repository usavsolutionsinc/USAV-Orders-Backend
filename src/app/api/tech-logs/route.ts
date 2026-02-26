import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const cacheLookup = createCacheLookupKey({ techId, limit, offset });

    try {
        const cached = await getCachedJson<any[]>('api:tech-logs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        // Resolve staff by numeric id first (current UI flow), with employee_id fallback.
        const techIdNum = parseInt(String(techId), 10);
        let staffResult = { rows: [] as Array<{ id: number }> };
        if (!Number.isNaN(techIdNum) && techIdNum > 0) {
            const byId = await pool.query(
                'SELECT id FROM staff WHERE id = $1 LIMIT 1',
                [techIdNum]
            );
            if (byId.rows.length > 0) {
                staffResult = byId;
            }
        }

        if (staffResult.rows.length === 0) {
            const techEmployeeIds: { [key: string]: string } = {
                '1': 'TECH001',
                '2': 'TECH002',
                '3': 'TECH003',
                '4': 'TECH004'
            };
            const employeeId = techEmployeeIds[String(techId)] || String(techId);
            const byEmployeeId = await pool.query(
                'SELECT id FROM staff WHERE employee_id = $1 LIMIT 1',
                [employeeId]
            );
            staffResult = byEmployeeId;
        }

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        const staffId = staffResult.rows[0].id;

        // Query tech serial logs and join matching order info by normalized tracking last-8.
        const result = await pool.query(`
            SELECT 
                tsn.id,
                tsn.test_date_time,
                tsn.shipping_tracking_number,
                tsn.serial_number,
                tsn.tested_by,
                o.id as order_db_id,
                CASE
                    WHEN UPPER(TRIM(COALESCE(tsn.shipping_tracking_number, ''))) LIKE 'X00%' THEN 'FBA'
                    ELSE o.order_id
                END as order_id,
                o.ship_by_date,
                o.created_at,
                o.item_number,
                COALESCE(
                    CASE
                        WHEN UPPER(TRIM(COALESCE(tsn.shipping_tracking_number, ''))) LIKE 'X00%' THEN fba.product_title
                        ELSE NULL
                    END,
                    o.product_title
                ) as product_title,
                o.quantity,
                o.condition,
                o.sku,
                o.account_source,
                o.notes,
                o.out_of_stock,
                o.is_shipped
            FROM tech_serial_numbers tsn
            LEFT JOIN LATERAL (
                SELECT product_title
                FROM fba_fnskus
                WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = UPPER(TRIM(COALESCE(tsn.shipping_tracking_number, '')))
                LIMIT 1
            ) fba ON true
            LEFT JOIN LATERAL (
                SELECT
                    id,
                    order_id,
                    ship_by_date,
                    created_at,
                    item_number,
                    product_title,
                    quantity,
                    condition,
                    sku,
                    account_source,
                    notes,
                    out_of_stock,
                    is_shipped
                FROM orders
                WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) =
                      RIGHT(regexp_replace(COALESCE(tsn.shipping_tracking_number, ''), '\\D', '', 'g'), 8)
                LIMIT 1
            ) o ON true
            WHERE tsn.tested_by = $1
              AND tsn.test_date_time IS NOT NULL
            ORDER BY tsn.test_date_time DESC NULLS LAST
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

        await setCachedJson('api:tech-logs', cacheLookup, result.rows, 20, ['tech-logs']);
        return NextResponse.json(result.rows, { headers: { 'x-cache': 'MISS' } });
    } catch (error: any) {
        console.error('Error fetching tech logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

// POST endpoint removed - replaced by /api/tech/scan-tracking and /api/tech/add-serial
