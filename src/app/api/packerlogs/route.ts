import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { packerLogs } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { getCurrentPSTDateKey } from '@/utils/date';
import { createStationActivityLog } from '@/lib/station-activity';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId');
    const limit = parseInt(searchParams.get('limit') || '5000');
    const offset = parseInt(searchParams.get('offset') || '0');
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    const cacheLookup = createCacheLookupKey({ packerId: packerId || '', limit, offset, weekStart, weekEnd });

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

        if (weekStart && weekEnd) {
            params.push(weekStart, weekEnd);
            const ws = params.length - 1;
            const we = params.length;
            conditions.push(`sal.created_at >= ($${ws}::date - interval '1 day')`);
            conditions.push(`sal.created_at <  ($${we}::date + interval '2 days')`);
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        params.push(limit, offset);
        const limitIdx = params.length - 1;
        const offsetIdx = params.length;

        const query = `
            SELECT
                sal.id,
                sal.created_at,
                sal.scan_ref,
                COALESCE(stn.tracking_number_raw, sal.scan_ref, sal.fnsku) AS shipping_tracking_number,
                sal.staff_id AS packed_by,
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
                COALESCE(o.condition, CASE WHEN sal.fnsku IS NOT NULL THEN 'FBA Scan' ELSE null END) AS condition,
                COALESCE(o.quantity, sal.metadata->>'quantity') AS quantity,
                COALESCE(o.sku, ff.sku, sal.metadata->>'sku') AS sku
            FROM station_activity_logs sal
            LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
            LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
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
            ${whereClause}
            ORDER BY sal.created_at DESC NULLS LAST
            LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        const result = await pool.query(query, params);

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
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const deletedLog = await db
            .delete(packerLogs)
            .where(eq(packerLogs.id, parseInt(id)))
            .returning();

        if (deletedLog.length === 0) {
            return NextResponse.json({ error: 'Log not found' }, { status: 404 });
        }

        await invalidateCacheTags(['packerlogs']);
        return NextResponse.json({ success: true, deletedLog: deletedLog[0] });
    } catch (error: any) {
        console.error('Error deleting packer log:', error);
        return NextResponse.json({ error: 'Failed to delete log', details: error.message }, { status: 500 });
    }
}
