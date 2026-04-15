import { NextRequest, NextResponse, after } from 'next/server';
import pool from '@/lib/db';
import { db } from '@/lib/drizzle/db';
import { packerLogs } from '@/lib/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { getCurrentPSTDateKey } from '@/utils/date';
import { createStationActivityLog } from '@/lib/station-activity';
import { createAuditLog } from '@/lib/audit-logs';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || searchParams.get('packedBy');
    const testedBy = searchParams.get('testedBy');
    const limit = parseInt(searchParams.get('limit') || '500');
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
        const cached = await getCachedJson<any[]>('api:packing-logs-v4', cacheLookup);
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
                to_char(sal.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
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
                NULL::json AS packer_photos_url,
                o.id AS order_row_id,
                o.shipment_id,
                o.order_id,
                COALESCE(o.account_source, CASE WHEN sal.fnsku IS NOT NULL THEN 'fba' ELSE null END) AS account_source,
                COALESCE(order_trackings.tracking_numbers, '[]'::json) AS tracking_numbers,
                COALESCE(order_trackings.tracking_number_rows, '[]'::json) AS tracking_number_rows,
                COALESCE(
                    ff.product_title,
                    o.product_title,
                    sku_catalog_lookup.catalog_product_title,
                    sku_stock_lookup.stock_product_title,
                    -- Last resort: show the identifier we do have instead of null.
                    NULLIF(BTRIM(o.item_number), ''),
                    NULLIF(BTRIM(o.sku), '')
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
                COALESCE(
                    NULLIF(TRIM(COALESCE(test_data.serial_number, '')), ''),
                    NULLIF(TRIM(COALESCE(sku_lookup.sku_table_serial, '')), '')
                ) AS serial_number,
                sku_lookup.sku_table_id AS sku_table_id,
                wa_t.assigned_tech_id AS tester_id,
                test_data.tested_by,
                test_data.test_date_time,
                tested_staff.name AS tested_by_name,
                tester_staff.name AS tester_name,
                sal.fnsku,
                (NULLIF(TRIM(sal.metadata->>'fnsku_log_id'), ''))::bigint AS fnsku_log_id
            FROM station_activity_logs sal
            LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
            LEFT JOIN LATERAL (
                SELECT
                    sk.id AS sku_table_id,
                    sk.serial_number AS sku_table_serial,
                    sk.static_sku AS sku_table_static_sku
                FROM v_sku sk
                WHERE sk.static_sku IS NOT NULL AND BTRIM(sk.static_sku) <> ''
                  AND (
                      (sal.shipment_id IS NOT NULL AND sk.shipment_id = sal.shipment_id)
                      OR BTRIM(sk.static_sku) = BTRIM(COALESCE(sal.scan_ref, ''))
                      OR (
                        NULLIF(TRIM(sal.metadata->>'sku'), '') IS NOT NULL
                        AND BTRIM(sk.static_sku) = BTRIM(sal.metadata->>'sku')
                      )
                      OR (
                        POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                        AND (
                            BTRIM(sk.static_sku) = BTRIM(split_part(sal.scan_ref, ':', 1))
                            OR BTRIM(sk.static_sku) = BTRIM(sal.scan_ref)
                            OR regexp_replace(UPPER(TRIM(COALESCE(sk.static_sku, ''))), '^0+', '') =
                               regexp_replace(UPPER(TRIM(split_part(sal.scan_ref, ':', 1))), '^0+', '')
                        )
                      )
                  )
                ORDER BY
                  CASE WHEN sal.shipment_id IS NOT NULL AND sk.shipment_id = sal.shipment_id THEN 0 ELSE 1 END,
                  sk.updated_at DESC NULLS LAST,
                  sk.id DESC
                LIMIT 1
            ) sku_lookup ON TRUE
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
            LEFT JOIN fba_fnskus ff ON ff.fnsku = sal.fnsku
            LEFT JOIN staff packed_staff ON packed_staff.id = sal.staff_id
            LEFT JOIN LATERAL (
                SELECT ord.id
                FROM orders ord
                LEFT JOIN order_shipment_links osl ON osl.order_row_id = ord.id
                LEFT JOIN shipping_tracking_numbers ord_stn ON ord_stn.id = ord.shipment_id
                WHERE (
                    sal.shipment_id IS NOT NULL
                    AND (
                      osl.shipment_id = sal.shipment_id
                      OR ord.shipment_id = sal.shipment_id
                    )
                ) OR (
                    COALESCE(stn.tracking_number_raw, sal.scan_ref, '') <> ''
                    AND ord_stn.tracking_number_raw IS NOT NULL
                    AND ord_stn.tracking_number_raw != ''
                    AND RIGHT(regexp_replace(UPPER(ord_stn.tracking_number_raw), '[^A-Z0-9]', '', 'g'), 18) =
                        RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_raw, sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
                )
                ORDER BY
                    CASE
                      WHEN sal.shipment_id IS NOT NULL AND osl.shipment_id = sal.shipment_id THEN 0
                      WHEN sal.shipment_id IS NOT NULL AND ord.shipment_id = sal.shipment_id THEN 1
                      ELSE 2
                    END,
                    CASE WHEN COALESCE(osl.is_primary, false) THEN 0 ELSE 1 END,
                    ord.created_at DESC NULLS LAST,
                    ord.id DESC
                LIMIT 1
            ) order_match ON TRUE
            LEFT JOIN orders o ON o.id = order_match.id
            LEFT JOIN LATERAL (
                SELECT sc.product_title AS catalog_product_title
                FROM sku_catalog sc
                WHERE EXISTS (
                    SELECT 1
                    FROM UNNEST(ARRAY[
                        NULLIF(BTRIM(split_part(COALESCE(sku_lookup.sku_table_static_sku, ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(sku_lookup.sku_table_static_sku, '')), ''),
                        NULLIF(BTRIM(split_part(COALESCE(sal.metadata->>'sku', ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(sal.metadata->>'sku', '')), ''),
                        CASE
                            WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                            THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 1)), '')
                            ELSE NULLIF(BTRIM(COALESCE(sal.scan_ref, '')), '')
                        END,
                        -- Cover ":TAG" scans: the after-colon segment may itself be the sku
                        CASE
                            WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                            THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 2)), '')
                            ELSE NULL
                        END,
                        NULLIF(BTRIM(split_part(COALESCE(o.sku, ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(o.sku, '')), ''),
                        -- Ecwid/manual orders often key on item_number instead of sku
                        NULLIF(BTRIM(COALESCE(o.item_number, '')), ''),
                        NULLIF(BTRIM(split_part(COALESCE(ff.sku, ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(ff.sku, '')), '')
                    ]) AS c(candidate)
                    WHERE c.candidate IS NOT NULL AND BTRIM(c.candidate) <> ''
                      AND (
                          BTRIM(sc.sku) = BTRIM(c.candidate)
                          OR regexp_replace(UPPER(TRIM(COALESCE(sc.sku, ''))), '^0+', '') =
                             regexp_replace(UPPER(TRIM(c.candidate)), '^0+', '')
                      )
                )
                LIMIT 1
            ) sku_catalog_lookup ON TRUE
            -- Parallel lookup in sku_stock — many SKUs have titles there that
            -- haven't been mirrored into sku_catalog yet (e.g. "01103" Bose
            -- Companion speakers). Leading-zero normalization matches the
            -- sku_catalog lookup above so ":1103" resolves to "01103".
            LEFT JOIN LATERAL (
                SELECT ss.product_title AS stock_product_title
                FROM sku_stock ss
                WHERE EXISTS (
                    SELECT 1
                    FROM UNNEST(ARRAY[
                        NULLIF(BTRIM(split_part(COALESCE(sku_lookup.sku_table_static_sku, ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(sku_lookup.sku_table_static_sku, '')), ''),
                        NULLIF(BTRIM(split_part(COALESCE(sal.metadata->>'sku', ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(sal.metadata->>'sku', '')), ''),
                        CASE
                            WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                            THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 1)), '')
                            ELSE NULLIF(BTRIM(COALESCE(sal.scan_ref, '')), '')
                        END,
                        CASE
                            WHEN POSITION(':' IN COALESCE(sal.scan_ref, '')) > 0
                            THEN NULLIF(BTRIM(split_part(sal.scan_ref, ':', 2)), '')
                            ELSE NULL
                        END,
                        NULLIF(BTRIM(split_part(COALESCE(o.sku, ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(o.sku, '')), ''),
                        NULLIF(BTRIM(COALESCE(o.item_number, '')), ''),
                        NULLIF(BTRIM(split_part(COALESCE(ff.sku, ''), ':', 1)), ''),
                        NULLIF(BTRIM(COALESCE(ff.sku, '')), '')
                    ]) AS c(candidate)
                    WHERE c.candidate IS NOT NULL AND BTRIM(c.candidate) <> ''
                      AND (
                          BTRIM(ss.sku) = BTRIM(c.candidate)
                          OR regexp_replace(UPPER(TRIM(COALESCE(ss.sku, ''))), '^0+', '') =
                             regexp_replace(UPPER(TRIM(c.candidate)), '^0+', '')
                      )
                )
                ORDER BY
                    -- Prefer rows with a non-empty title over placeholders
                    CASE WHEN NULLIF(BTRIM(COALESCE(ss.product_title, '')), '') IS NULL THEN 1 ELSE 0 END,
                    ss.stock DESC NULLS LAST,
                    ss.id DESC
                LIMIT 1
            ) sku_stock_lookup ON TRUE
            LEFT JOIN LATERAL (
                SELECT COALESCE(
                  json_agg(t.tracking_number_raw ORDER BY t.sort_key, t.tracking_number_raw)
                    FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
                  '[]'::json
                ) AS tracking_numbers,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'shipment_id', t.shipment_id,
                      'tracking', t.tracking_number_raw,
                      'is_primary', t.is_primary
                    )
                    ORDER BY t.sort_key, t.tracking_number_raw
                  ) FILTER (WHERE COALESCE(t.tracking_number_raw, '') <> ''),
                  '[]'::json
                ) AS tracking_number_rows
                FROM (
                  SELECT DISTINCT
                    osl_link.shipment_id,
                    stn_link.tracking_number_raw,
                    COALESCE(osl_link.is_primary, false) AS is_primary,
                    CASE WHEN COALESCE(osl_link.is_primary, false) THEN 0 ELSE 1 END AS sort_key
                  FROM order_shipment_links osl_link
                  LEFT JOIN shipping_tracking_numbers stn_link ON stn_link.id = osl_link.shipment_id
                  WHERE o.id IS NOT NULL
                    AND osl_link.order_row_id = o.id

                  UNION

                  SELECT DISTINCT
                    o_primary.shipment_id,
                    stn_primary.tracking_number_raw,
                    true AS is_primary,
                    0 AS sort_key
                  FROM orders o_primary
                  LEFT JOIN shipping_tracking_numbers stn_primary ON stn_primary.id = o_primary.shipment_id
                  WHERE o.id IS NOT NULL
                    AND o_primary.id = o.id
                ) t
            ) order_trackings ON TRUE
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

        // Batch-fetch photos in one query instead of N correlated subqueries
        const packerLogIds = result.rows
            .map((r: any) => r.packer_log_id)
            .filter((id: any) => id != null);

        let photosMap: Record<number, any[]> = {};
        if (packerLogIds.length > 0) {
            const photosResult = await pool.query(
                `SELECT entity_id, json_agg(json_build_object('url', url, 'uploadedAt', created_at) ORDER BY created_at) AS photos
                 FROM photos
                 WHERE entity_type = 'PACKER_LOG' AND entity_id = ANY($1)
                 GROUP BY entity_id`,
                [packerLogIds]
            );
            for (const row of photosResult.rows) {
                photosMap[row.entity_id] = row.photos;
            }
        }

        const rows = result.rows.map((r: any) => ({
            ...r,
            packer_photos_url: photosMap[r.packer_log_id] ?? [],
        }));

        after(() => setCachedJson('api:packing-logs-v4', cacheLookup, rows, cacheTTL, ['packing-logs']));
        return NextResponse.json(rows, { headers: { 'x-cache': 'MISS', ...CACHE_HEADERS } });
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
        const salId = await createStationActivityLog(pool, {
            station: 'PACK',
            activityType: body.trackingType === 'ORDERS' ? 'PACK_COMPLETED' : 'PACK_SCAN',
            staffId: body.packedBy ?? null,
            shipmentId: shipmentId ?? null,
            scanRef: scanRef ?? body.shippingTrackingNumber ?? null,
            packerLogId,
            metadata: {
                source: 'packerlogs.post',
                tracking_type: body.trackingType || 'ORDERS',
            },
        });
        if ((body.trackingType || 'ORDERS') === 'ORDERS') {
            await createAuditLog(pool, {
                actorStaffId: body.packedBy ?? null,
                source: 'api.packerlogs.post',
                action: 'PACK_COMPLETED',
                entityType: shipmentId ? 'SHIPMENT' : 'PACKER_LOG',
                entityId: String(shipmentId ?? packerLogId ?? body.shippingTrackingNumber ?? 'unknown'),
                stationActivityLogId: salId,
                metadata: {
                    tracking_type: body.trackingType || 'ORDERS',
                },
            });
        }
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
        await invalidateCacheTags(['packing-logs', 'orders']);
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

        await invalidateCacheTags(['packing-logs']);
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
            await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
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
        await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
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
