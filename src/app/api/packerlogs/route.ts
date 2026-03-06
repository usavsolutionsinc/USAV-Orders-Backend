import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { packerLogs } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId');
    const limit = parseInt(searchParams.get('limit') || '5000');
    const offset = parseInt(searchParams.get('offset') || '0');
    const weekStart = searchParams.get('weekStart') || '';
    const weekEnd = searchParams.get('weekEnd') || '';
    const cacheLookup = createCacheLookupKey({ packerId: packerId || '', limit, offset, weekStart, weekEnd });

    const today = new Date().toISOString().substring(0, 10);
    const cacheTTL = weekEnd && weekEnd < today ? 86400 : 120;
    const CACHE_HEADERS = { 'Cache-Control': `private, max-age=${cacheTTL}, stale-while-revalidate=30` };

    try {
        const cached = await getCachedJson<any[]>('api:packerlogs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT', ...CACHE_HEADERS } });
        }

        const params: any[] = [];
        const conditions: string[] = [];

        if (packerId) {
            const packerIdNum = parseInt(packerId);
            if (!isNaN(packerIdNum)) {
                params.push(packerIdNum);
                conditions.push(`pl.packed_by = $${params.length}`);
            }
        }

        // Week pre-filter with ±1 day UTC buffer so PST boundary records are included;
        // client groups by PST date for precise display.
        if (weekStart && weekEnd) {
            params.push(weekStart, weekEnd);
            const ws = params.length - 1;
            const we = params.length;
            conditions.push(`pl.pack_date_time >= ($${ws}::date - interval '1 day')`);
            conditions.push(`pl.pack_date_time <  ($${we}::date + interval '2 days')`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit, offset);
        const limitIdx = params.length - 1;
        const offsetIdx = params.length;

        const query = `
            SELECT 
                pl.id,
                pl.pack_date_time,
                pl.shipping_tracking_number,
                pl.packed_by,
                COALESCE(
                    (SELECT json_agg(json_build_object('url', p.url, 'uploadedAt', p.created_at) ORDER BY p.created_at)
                     FROM photos p
                     WHERE p.entity_type = 'PACKER_LOG' AND p.entity_id = pl.id),
                    '[]'::json
                ) AS packer_photos_url,
                (
                    SELECT o.order_id 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(pl.shipping_tracking_number, 8)
                    LIMIT 1
                ) as order_id,
                (
                    SELECT COALESCE(
                        (
                            SELECT ss.product_title
                            FROM sku_stock ss
                            WHERE POSITION(':' IN COALESCE(pl.shipping_tracking_number, '')) > 0
                              AND regexp_replace(UPPER(TRIM(COALESCE(ss.sku, ''))), '^0+', '') =
                                  regexp_replace(UPPER(TRIM(split_part(pl.shipping_tracking_number, ':', 1))), '^0+', '')
                            LIMIT 1
                        ),
                        (
                            SELECT o.product_title
                            FROM orders o
                            WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(pl.shipping_tracking_number, 8)
                            LIMIT 1
                        )
                    )
                ) as product_title,
                (
                    SELECT o.condition 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(pl.shipping_tracking_number, 8)
                    LIMIT 1
                ) as condition,
                (
                    SELECT o.quantity
                    FROM orders o
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(pl.shipping_tracking_number, 8)
                    LIMIT 1
                ) as quantity,
                (
                    SELECT o.sku 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(pl.shipping_tracking_number, 8)
                    LIMIT 1
                ) as sku
            FROM packer_logs pl
            ${whereClause}
            ORDER BY pl.pack_date_time DESC NULLS LAST
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

        const newLog = await db.insert(packerLogs).values({
            packDateTime: body.packDateTime,
            shippingTrackingNumber: body.shippingTrackingNumber,
            trackingType: body.trackingType || 'ORDERS',
            packedBy: body.packedBy,
        }).returning();

        const packerLogId = newLog[0]?.id;
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

        await invalidateCacheTags(['packerlogs']);
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
