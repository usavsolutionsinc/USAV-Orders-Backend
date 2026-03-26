import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { packerLogs } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { getCurrentPSTDateKey } from '@/utils/date';
import { createStationActivityLog } from '@/lib/station-activity';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || searchParams.get('packedBy');
    const testedBy = searchParams.get('testedBy');
    const limit = parseInt(searchParams.get('limit') || '5000');
    const offset = parseInt(searchParams.get('offset') || '0');
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    // Accept shippedFilter (from dashboard) or trackingType (legacy direct callers)
    const rawTypeFilter = searchParams.get('shippedFilter') || searchParams.get('trackingType') || 'all';
    const trackingTypeFilter: 'all' | 'orders' | 'sku' | 'fba' =
      rawTypeFilter === 'orders' ? 'orders'
      : rawTypeFilter === 'fba' ? 'fba'
      : rawTypeFilter === 'sku' ? 'sku'
      : 'all';
    const cacheLookup = createCacheLookupKey({
        packerId: packerId || '',
        testedBy: testedBy || '',
        limit,
        offset,
        weekStart,
        weekEnd,
        trackingTypeFilter,
    });

    const today = getCurrentPSTDateKey();
    const cacheTTL = weekEnd && weekEnd < today ? 86400 : 120;
    const CACHE_HEADERS = { 'Cache-Control': `private, max-age=${cacheTTL}, stale-while-revalidate=30` };

    try {
        const cached = await getCachedJson<any[]>('api:packerlogs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
        }

        const params: any[] = [];
        const conditions: string[] = [`sal.station = 'PACK'`];

        if (packerId) {
            const packerIdNum = parseInt(packerId);
            if (!isNaN(packerIdNum)) {
                params.push(packerIdNum);
                conditions.push(`sal.staff_id = $${params.length}`);
            }
        }

        if (testedBy) {
            const testedByNum = parseInt(testedBy);
            if (!isNaN(testedByNum)) {
                params.push(testedByNum);
                const testedByIdx = params.length;
                conditions.push(`(test_data.tested_by = $${testedByIdx} OR wa_t.assigned_tech_id = $${testedByIdx})`);
            }
        }

        if (weekStart && weekEnd) {
            params.push(weekStart, weekEnd);
            const ws = params.length - 1;
            const we = params.length;
            conditions.push(`sal.created_at >= ($${ws}::date - interval '1 day')`);
            conditions.push(`sal.created_at <  ($${we}::date + interval '2 days')`);
        }

        // Type filter — FBA records are identified by scan_ref matching the Amazon FBA
        // shipment ID format (FBA + 8+ alphanumeric chars) or tracking_type IN ('FBA','FNSKU').
        if (trackingTypeFilter === 'fba') {
            conditions.push(
                `(COALESCE(pl.tracking_type, '') IN ('FBA', 'FNSKU')`
                + ` OR sal.activity_type = 'FBA_READY'`
                + ` OR COALESCE(sal.scan_ref, '') ~* '^FBA[0-9A-Z]{8,}$')`,
            );
        } else if (trackingTypeFilter === 'orders') {
            conditions.push(
                `(COALESCE(pl.tracking_type, 'ORDERS') = 'ORDERS'`
                + ` AND COALESCE(sal.scan_ref, '') !~* '^FBA[0-9A-Z]{8,}$'`
                + ` AND sal.activity_type != 'FBA_READY')`,
            );
        } else if (trackingTypeFilter === 'sku') {
            conditions.push(`COALESCE(pl.tracking_type, '') = 'SKU'`);
        }
        // 'all' → no restriction

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        params.push(limit, offset);
        const limitIdx = params.length - 1;
        const offsetIdx = params.length;

        const query = `
            SELECT
                sal.id,
                sal.packer_log_id AS packer_log_id,
                sal.created_at,
                sal.scan_ref,
                COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku) AS shipping_tracking_number,
                sal.staff_id AS packed_by,
                packed_staff.name AS packed_by_name,
                COALESCE(pl.tracking_type,
                         CASE sal.activity_type
                           WHEN 'FBA_READY' THEN 'FNSKU'
                           WHEN 'PACK_COMPLETED' THEN 'ORDERS'
                           ELSE 'SCAN'
                         END) AS tracking_type,
                COALESCE(
                    (SELECT json_agg(json_build_object('url', p.url, 'uploadedAt', p.created_at) ORDER BY p.created_at)
                     FROM photos p
                     WHERE p.entity_type = 'PACKER_LOG' AND p.entity_id = sal.packer_log_id),
                    '[]'::json
                ) AS packer_photos_url,
                o.id AS order_row_id,
                o.shipment_id,
                o.order_id,
                COALESCE(o.account_source, CASE WHEN sal.fnsku IS NOT NULL THEN 'fba' ELSE null END) AS account_source,
                COALESCE(
                    (
                        SELECT ss.product_title
                        FROM sku_stock ss
                        WHERE POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                          AND regexp_replace(UPPER(TRIM(COALESCE(ss.sku, ''))), '^0+', '') =
                              regexp_replace(UPPER(TRIM(split_part(sal.scan_ref, ':', 1))), '^0+', '')
                        LIMIT 1
                    ),
                    ff.product_title,
                    o.product_title
                ) AS product_title,
                to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS ship_by_date,
                to_char(wa_deadline.deadline_at, 'YYYY-MM-DD HH24:MI:SS') AS deadline_at,
                o.item_number,
                NULLIF(TRIM(COALESCE(o.condition, '')), '') AS condition,
                COALESCE(o.quantity, sal.metadata->>'quantity') AS quantity,
                COALESCE(
                    o.sku,
                    ff.sku,
                    sal.metadata->>'sku',
                    -- SKU scans store "SKU_VALUE:QUANTITY" in scan_ref; extract the SKU part
                    CASE WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                         THEN TRIM(split_part(sal.scan_ref, ':', 1))
                         ELSE NULL
                    END
                ) AS sku,
                COALESCE(o.notes, '') AS notes,
                COALESCE(o.status_history, '[]'::jsonb) AS status_history,
                COALESCE(test_data.serial_number, '') AS serial_number,
                wa_t.assigned_tech_id AS tester_id,
                test_data.tested_by,
                test_data.test_date_time,
                tested_staff.name AS tested_by_name,
                tester_staff.name AS tester_name
            FROM station_activity_logs sal
            LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
            LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
            LEFT JOIN staff packed_staff ON packed_staff.id = sal.staff_id
            LEFT JOIN LATERAL (
                SELECT ord.id
                FROM orders ord
                LEFT JOIN shipping_tracking_numbers ord_stn ON ord_stn.id = ord.shipment_id
                WHERE (
                    sal.shipment_id IS NOT NULL
                    AND ord.shipment_id = sal.shipment_id
                ) OR (
                    COALESCE(stn.tracking_number_raw, sal.scan_ref, '') <> ''
                    AND ord_stn.tracking_number_raw IS NOT NULL
                    AND ord_stn.tracking_number_raw != ''
                    AND RIGHT(regexp_replace(UPPER(ord_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                        RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
                )
                ORDER BY
                    CASE WHEN sal.shipment_id IS NOT NULL AND ord.shipment_id = sal.shipment_id THEN 0 ELSE 1 END,
                    ord.created_at DESC NULLS LAST,
                    ord.id DESC
                LIMIT 1
            ) order_match ON TRUE
            LEFT JOIN orders o ON o.id = order_match.id
            LEFT JOIN LATERAL (
                SELECT wa.deadline_at
                FROM work_assignments wa
                WHERE wa.entity_type = 'ORDER'
                  AND wa.entity_id = o.id
                  AND wa.work_type = 'TEST'
                ORDER BY
                  CASE wa.status
                    WHEN 'IN_PROGRESS' THEN 1
                    WHEN 'ASSIGNED' THEN 2
                    WHEN 'OPEN' THEN 3
                    WHEN 'DONE' THEN 4
                    ELSE 5
                  END,
                  wa.updated_at DESC,
                  wa.id DESC
                LIMIT 1
            ) wa_deadline ON TRUE
            LEFT JOIN LATERAL (
                SELECT assigned_tech_id
                FROM work_assignments
                WHERE entity_type = 'ORDER'
                  AND entity_id = o.id
                  AND work_type = 'TEST'
                  AND status IN ('ASSIGNED', 'IN_PROGRESS')
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            ) wa_t ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    COALESCE(STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.created_at), '') AS serial_number,
                    MIN(tsn.tested_by)::int AS tested_by,
                    MIN(tsn.created_at)::text AS test_date_time
                FROM tech_serial_numbers tsn
                WHERE o.shipment_id IS NOT NULL
                  AND tsn.shipment_id = o.shipment_id
            ) test_data ON TRUE
            LEFT JOIN staff tested_staff ON tested_staff.id = test_data.tested_by
            LEFT JOIN staff tester_staff ON tester_staff.id = wa_t.assigned_tech_id
            ${whereClause}
            ORDER BY sal.created_at DESC NULLS LAST
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        const result = await queryWithRetry(
            () => pool.query(query, params),
            { retries: 3, delayMs: 1000 }
        );

        await setCachedJson('api:packerlogs', cacheLookup, result.rows, cacheTTL, ['packerlogs']);
        return NextResponse.json(result.rows, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
    } catch (error: any) {
        console.error('Error fetching packer logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const { shipmentId, scanRef } = await resolveShipmentId(body.shippingTrackingNumber || '');
        const newLog = await db.insert(packerLogs).values({
            shipmentId: shipmentId ?? undefined,
            scanRef: scanRef ?? undefined,
            trackingType: body.trackingType || 'ORDERS',
            packedBy: body.packedBy,
        }).returning();

        const packerLogId = newLog[0]?.id;
        await createStationActivityLog(pool, {
            station: 'PACK',
            activityType: body.trackingType === 'ORDERS' ? 'PACK_COMPLETED' : 'PACK_SCAN',
            staffId: body.packedBy ?? null,
            shipmentId: shipmentId ?? null,
            scanRef: scanRef ?? body.shippingTrackingNumber ?? null,
            packerLogId,
            metadata: {
                tracking_type: body.trackingType || 'ORDERS',
            },
        });
        if (packerLogId && Array.isArray(body.packerPhotosUrl) && body.packerPhotosUrl.length > 0) {
            for (const url of body.packerPhotosUrl) {
                if (typeof url === 'string' && url.trim()) {
                    await pool.query(
                        `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
                         VALUES ('PACKER_LOG', $1, $2, $3, 'box_label')
                         ON CONFLICT (entity_type, entity_id, url) DO NOTHING`,
                        [packerLogId, url, body.packedBy || null]
                    );
                }
            }
        }

        // Bust both packerlogs and orders caches: is_packed is computed in /api/orders,
        // so creating a new packer log must clear the orders cache too.
        await invalidateCacheTags(['packerlogs', 'orders']);
        return NextResponse.json(newLog[0]);
    } catch (error: any) {
        console.error('Error creating packer log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const { id, ...updateData } = body;

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const updatedLog = await db
            .update(packerLogs)
            .set(updateData)
            .where(eq(packerLogs.id, parseInt(id)))
            .returning();

        if (updatedLog.length === 0) {
            return NextResponse.json({ error: 'Log not found' }, { status: 404 });
        }

        await invalidateCacheTags(['packerlogs']);
        return NextResponse.json(updatedLog[0]);
    } catch (error: any) {
        console.error('Error updating packer log:', error);
        return NextResponse.json({ error: 'Failed to update log', details: error.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const activityLogId = searchParams.get('activityLogId');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (activityLogId) {
            const salId = parseInt(activityLogId, 10);
            if (Number.isNaN(salId)) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Invalid activityLogId' }, { status: 400 });
            }
            const sel = await client.query(
                'SELECT packer_log_id FROM station_activity_logs WHERE id = $1',
                [salId]
            );
            if (!sel.rows[0]) {
                await client.query('ROLLBACK');
                return NextResponse.json({ error: 'Log not found' }, { status: 404 });
            }
            const plId: number | null = sel.rows[0].packer_log_id ?? null;
            await client.query('DELETE FROM station_activity_logs WHERE id = $1', [salId]);
            if (plId != null) {
                await client.query('DELETE FROM packer_logs WHERE id = $1', [plId]);
            }
            await client.query('COMMIT');
            await invalidateCacheTags(['packerlogs', 'orders']);
            return NextResponse.json({ success: true });
        }

        if (!id) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const plId = parseInt(id, 10);
        if (Number.isNaN(plId)) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
        }

        const plCheck = await client.query('SELECT id FROM packer_logs WHERE id = $1', [plId]);
        if (!plCheck.rows[0]) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Log not found' }, { status: 404 });
        }

        await client.query('DELETE FROM station_activity_logs WHERE packer_log_id = $1', [plId]);
        await client.query('DELETE FROM packer_logs WHERE id = $1', [plId]);
        await client.query('COMMIT');
        await invalidateCacheTags(['packerlogs', 'orders']);
        return NextResponse.json({ success: true, deletedLog: { id: plId } });
    } catch (error: any) {
        try {
            await client.query('ROLLBACK');
        } catch {
            /* ignore */
        }
        console.error('Error deleting packer log:', error);
        return NextResponse.json({ error: 'Failed to delete log', details: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
