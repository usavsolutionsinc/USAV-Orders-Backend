import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    const cacheLookup = createCacheLookupKey({ techId, limit, offset, weekStart, weekEnd });

    // Use shorter TTL for the current week so new entries appear quickly;
    // historical weeks can be cached for 24 hours.
    const today = new Date().toISOString().substring(0, 10);
    const cacheTTL = weekEnd && weekEnd < today ? 86400 : 120;
    const CACHE_HEADERS = { 'Cache-Control': `private, max-age=${cacheTTL}, stale-while-revalidate=30` };

    try {
        const cached = await getCachedJson<any[]>('api:tech-logs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
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

        // Build parameterized WHERE clause — add optional week pre-filter (UTC ±1 day
        // buffer so PST day-boundary records are included; client groups by PST date).
        const queryParams: any[] = [staffId];
        let idx = 2;
        let weekClause = '';
        if (weekStart && weekEnd) {
            weekClause = `
              AND tsn.created_at >= ($${idx}::date - interval '1 day')
              AND tsn.created_at <  ($${idx + 1}::date + interval '2 days')`;
            queryParams.push(weekStart, weekEnd);
            idx += 2;
        }
        queryParams.push(limit, offset);
        const limitIdx = idx;
        const offsetIdx = idx + 1;

        // Query tech serial logs joined to the best matching order.
        // Prefer shipment_id FK; the text fallback matches via shipping_tracking_numbers
        // (orders no longer carries a shipping_tracking_number text column).
        const result = await pool.query(`
            SELECT
                tsn.id,
                tsn.created_at,
                COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number,
                tsn.serial_number,
                tsn.tested_by,
                order_match.shipment_id,
                o.id as order_db_id,
                CASE
                    WHEN UPPER(TRIM(COALESCE(tsn.scan_ref, stn.tracking_number_raw, ''))) LIKE 'X00%' THEN 'FBA'
                    ELSE o.order_id
                END as order_id,
                wa_deadline.deadline_at AS ship_by_date,
                o.created_at,
                o.item_number,
                COALESCE(
                    CASE
                        WHEN UPPER(TRIM(COALESCE(tsn.scan_ref, stn.tracking_number_raw, ''))) LIKE 'X00%' THEN fba.product_title
                        ELSE NULL
                    END,
                    o.product_title
                ) as product_title,
                o.quantity,
                o.condition,
                o.sku,
                o.status,
                o.status_history,
                o.account_source,
                o.notes,
                o.out_of_stock,
                COALESCE(o_stn.is_carrier_accepted OR o_stn.is_in_transit
                  OR o_stn.is_out_for_delivery OR o_stn.is_delivered, false) AS is_shipped
            FROM tech_serial_numbers tsn
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
            LEFT JOIN LATERAL (
                SELECT
                    o_match.id,
                    o_match.shipment_id
                FROM orders o_match
                LEFT JOIN shipping_tracking_numbers o_match_stn ON o_match_stn.id = o_match.shipment_id
                WHERE (
                    tsn.shipment_id IS NOT NULL
                    AND o_match.shipment_id = tsn.shipment_id
                ) OR (
                    COALESCE(tsn.scan_ref, stn.tracking_number_raw, '') <> ''
                    AND o_match_stn.tracking_number_raw IS NOT NULL
                    AND o_match_stn.tracking_number_raw != ''
                    AND RIGHT(regexp_replace(UPPER(o_match_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                        RIGHT(regexp_replace(UPPER(COALESCE(tsn.scan_ref, stn.tracking_number_raw, '')), '[^A-Z0-9]', '', 'g'), 18)
                )
                ORDER BY
                    CASE WHEN tsn.shipment_id IS NOT NULL AND o_match.shipment_id = tsn.shipment_id THEN 0 ELSE 1 END,
                    o_match.created_at DESC NULLS LAST,
                    o_match.id DESC
                LIMIT 1
            ) order_match ON TRUE
            LEFT JOIN orders o ON o.id = order_match.id
            LEFT JOIN shipping_tracking_numbers o_stn ON o_stn.id = o.shipment_id
            LEFT JOIN LATERAL (
                SELECT wa.deadline_at
                FROM work_assignments wa
                WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
                ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                         wa.updated_at DESC, wa.id DESC LIMIT 1
            ) wa_deadline ON o.id IS NOT NULL
            LEFT JOIN LATERAL (
                SELECT product_title
                FROM fba_fnskus
                WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = UPPER(TRIM(COALESCE(tsn.scan_ref, '')))
                LIMIT 1
            ) fba ON tsn.scan_ref IS NOT NULL AND UPPER(TRIM(COALESCE(tsn.scan_ref, ''))) LIKE 'X00%'
            WHERE tsn.tested_by = $1
              AND tsn.created_at IS NOT NULL
              ${weekClause}
            ORDER BY tsn.created_at DESC NULLS LAST
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, queryParams);

        await setCachedJson('api:tech-logs', cacheLookup, result.rows, cacheTTL, ['tech-logs']);
        return NextResponse.json(result.rows, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
    } catch (error: any) {
        console.error('Error fetching tech logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

// POST endpoint removed - replaced by /api/tech/scan-tracking and /api/tech/add-serial
