import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';
import { checkRateLimit } from '@/lib/api-guard';
import { invalidateCacheTags, createCacheLookupKey, getCachedJson, setCachedJson } from '@/lib/cache/upstash-cache';
import { formatPSTTimestamp } from '@/lib/timezone';
import { publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';

/** Compute Mon–Fri PST week range from the current PST timestamp. */
function getCurrentPSTWeekRange(): { startStr: string; endStr: string } {
    const ts = formatPSTTimestamp(); // 'YYYY-MM-DDTHH:MM:SS' in PST
    const dateKey = ts.substring(0, 10);
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(date);
    monday.setDate(date.getDate() - daysFromMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { startStr: fmt(monday), endStr: fmt(friday) };
}

/**
 * Prepend a single new TechRecord to the current week's Redis cache entry
 * (keyed by techId + week range) without nuking the whole cache.
 */
async function prependToTechLogsCache(techId: number, newRecord: Record<string, unknown>) {
    const { startStr, endStr } = getCurrentPSTWeekRange();
    const cacheKey = createCacheLookupKey({
        techId: String(techId),
        limit: 1000,
        offset: 0,
        weekStart: startStr,
        weekEnd: endStr,
    });
    const existing = await getCachedJson<any[]>('api:tech-logs', cacheKey);
    if (Array.isArray(existing)) {
        await setCachedJson(
            'api:tech-logs',
            cacheKey,
            [newRecord, ...existing].slice(0, 1000),
            120,
            ['tech-logs'],
        );
    }
}

const FBA_LIKE_RE = /^(X00|X0|B0|FBA)/i;

async function hasMatchingFbaFnsku(fnsku: string, dbClient: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> } = pool): Promise<boolean> {
    const normalized = String(fnsku || '').trim().toUpperCase();
    if (!normalized) return false;

    try {
        const primary = await dbClient.query(
            `SELECT 1
             FROM fba_fnskus
             WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
             LIMIT 1`,
            [normalized]
        );
        if (primary.rows.length > 0) return true;
    } catch (err: any) {
        if (err?.code !== '42P01') {
            throw err;
        }
    }

    try {
        const fallback = await dbClient.query(
            `SELECT 1
             FROM fba_fnsku
             WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
             LIMIT 1`,
            [normalized]
        );
        return fallback.rows.length > 0;
    } catch (err: any) {
        if (err?.code === '42P01') return false;
        throw err;
    }
}

export async function POST(req: NextRequest) {
    const rate = checkRateLimit({
        headers: req.headers,
        routeKey: 'tech-scan-tracking',
        limit: 120,
        windowMs: 60_000,
    });
    if (!rate.ok) {
        return NextResponse.json(
            { success: false, found: false, error: 'Rate limit exceeded. Please retry shortly.' },
            { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined }
        );
    }

    const rawBody = await req.text();
    if (!rawBody?.trim()) {
        return NextResponse.json({ success: false, found: false, error: 'Request body is required' }, { status: 400 });
    }

    let parsed: { tracking?: string; techId?: string | number };
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ success: false, found: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const tracking = String(parsed.tracking || '').trim();
    const techId = String(parsed.techId || '').trim();

    if (!tracking) {
        return NextResponse.json({ success: false, found: false, error: 'Tracking number is required' }, { status: 400 });
    }

    if (!techId) {
        return NextResponse.json({ success: false, found: false, error: 'Tech ID is required' }, { status: 400 });
    }

    try {
        const scannedTracking = String(tracking || '').trim();
        const key18 = normalizeTrackingKey18(scannedTracking);
        if (!key18) {
            return NextResponse.json({ success: false, found: false, error: 'Invalid tracking number' }, { status: 400 });
        }
        const resolvedScan = await resolveShipmentId(scannedTracking);
        const techIdNum = parseInt(techId, 10);
        if (!techIdNum) {
            return NextResponse.json({ success: false, found: false, error: 'Invalid Tech ID' }, { status: 400 });
        }

        const parseSerials = (value: string | null | undefined) =>
            String(value || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const staffResult = await client.query(
                `SELECT id, name FROM staff WHERE id = $1 LIMIT 1`,
                [techIdNum]
            );
            if (staffResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ success: false, found: false, error: 'Tech not found in staff table' }, { status: 404 });
            }
            const testedBy = staffResult.rows[0].id;
            const testedByName = staffResult.rows[0].name || null;

            // Query orders table by tracking first so active order always has product info.
            // packer_id and tester_id are sourced from work_assignments (removed from orders).
            const result = await client.query(`
                SELECT
                    o.id,
                    o.order_id,
                    o.product_title,
                    o.item_number,
                    o.sku,
                    o.condition,
                    o.notes,
                    COALESCE(stn.tracking_number_raw, o.shipping_tracking_number) AS shipping_tracking_number,
                    o.account_source,
                    o.status,
                    o.status_history,
                    o.is_shipped,
                    o.out_of_stock,
                    to_char(wa_deadline.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
                    o.order_date,
                    o.created_at,
                    o.quantity,
                    wa_test.assigned_tech_id   AS tester_id,
                    wa_pack.assigned_packer_id AS packer_id
                FROM orders o
                LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                LEFT JOIN LATERAL (
                    SELECT wa.deadline_at FROM work_assignments wa
                    WHERE wa.entity_type = 'ORDER' AND wa.entity_id = o.id AND wa.work_type = 'TEST'
                    ORDER BY CASE wa.status WHEN 'IN_PROGRESS' THEN 1 WHEN 'ASSIGNED' THEN 2 WHEN 'OPEN' THEN 3 WHEN 'DONE' THEN 4 ELSE 5 END,
                             wa.updated_at DESC, wa.id DESC LIMIT 1
                ) wa_deadline ON TRUE
                LEFT JOIN LATERAL (
                    SELECT assigned_tech_id
                    FROM work_assignments
                    WHERE entity_type = 'ORDER'
                      AND entity_id   = o.id
                      AND work_type   = 'TEST'
                      AND status NOT IN ('CANCELED', 'DONE')
                    ORDER BY id DESC
                    LIMIT 1
                ) wa_test ON TRUE
                LEFT JOIN LATERAL (
                    SELECT assigned_packer_id
                    FROM work_assignments
                    WHERE entity_type = 'ORDER'
                      AND entity_id   = o.id
                      AND work_type   = 'PACK'
                      AND status NOT IN ('CANCELED', 'DONE')
                    ORDER BY id DESC
                    LIMIT 1
                ) wa_pack ON TRUE
                WHERE (
                    $1::bigint IS NOT NULL
                    AND o.shipment_id = $1
                ) OR (
                    o.shipping_tracking_number IS NOT NULL
                    AND o.shipping_tracking_number != ''
                    AND RIGHT(regexp_replace(UPPER(o.shipping_tracking_number), '[^A-Z0-9]', '', 'g'), 18) = $2
                )
                ORDER BY
                    CASE WHEN $1::bigint IS NOT NULL AND o.shipment_id = $1 THEN 0 ELSE 1 END,
                    o.id DESC
                LIMIT 1
            `, [resolvedScan.shipmentId, key18]);

            // Check tech_serial_numbers for existing tracking entry
            const existingTracking = await client.query(
                `SELECT
                    tsn.id,
                    tsn.serial_number,
                    COALESCE(stn.tracking_number_raw, tsn.scan_ref) AS shipping_tracking_number
                 FROM tech_serial_numbers tsn
                 LEFT JOIN shipping_tracking_numbers stn ON stn.id = tsn.shipment_id
                 WHERE (
                    $1::bigint IS NOT NULL
                    AND tsn.shipment_id = $1
                 ) OR (
                    tsn.scan_ref IS NOT NULL
                    AND tsn.scan_ref != ''
                    AND RIGHT(regexp_replace(UPPER(tsn.scan_ref), '[^A-Z0-9]', '', 'g'), 18) = $2
                 )
                 ORDER BY tsn.id DESC
                 LIMIT 1`,
                [resolvedScan.shipmentId, key18]
            );

            const row = result.rows[0] || null;
            const trackingValue =
                row?.shipping_tracking_number ||
                existingTracking.rows[0]?.shipping_tracking_number ||
                scannedTracking;

            if (!row) {
                const isFbaLikeTracking = FBA_LIKE_RE.test(scannedTracking);
                const fnskuFound = isFbaLikeTracking
                    ? await hasMatchingFbaFnsku(scannedTracking, client)
                    : false;

                if (!isFbaLikeTracking || !fnskuFound) {
                    await upsertOpenOrderException({
                        shippingTrackingNumber: scannedTracking,
                        sourceStation: 'tech',
                        staffId: testedBy,
                        staffName: testedByName,
                        reason: 'not_found',
                        notes: isFbaLikeTracking
                            ? 'Tech scan: FNSKU not found in fba_fnskus'
                            : 'Tech scan: tracking not found in orders',
                    }, client);
                }

                const exactTrackingRow = await client.query(
                    `SELECT id, serial_number
                     FROM tech_serial_numbers
                     WHERE (
                        $1::bigint IS NOT NULL
                        AND shipment_id = $1
                     ) OR (
                        scan_ref = $2
                     )
                     ORDER BY id ASC
                     LIMIT 1`,
                    [resolvedScan.shipmentId, resolvedScan.scanRef ?? scannedTracking]
                );

                let techSerialId: number | null = null;
                let techTestDateTime: string | null = null;

                if (exactTrackingRow.rows.length === 0) {
                    const insertResult = await client.query(
                        `INSERT INTO tech_serial_numbers (
                            shipment_id, scan_ref, serial_number, test_date_time, tested_by
                        ) VALUES ($1, $2, $3, date_trunc('second', NOW()), $4)
                        RETURNING id, test_date_time::text`,
                        [resolvedScan.shipmentId, resolvedScan.scanRef, '', testedBy]
                    );
                    techSerialId = insertResult.rows[0]?.id ?? null;
                    techTestDateTime = insertResult.rows[0]?.test_date_time ?? null;
                }
                const serialSource =
                    exactTrackingRow.rows[0]?.serial_number ??
                    existingTracking.rows[0]?.serial_number ??
                    '';

                await client.query('COMMIT');
                await invalidateCacheTags(['orders-next']); // exceptions upserted above

                // Surgical cache update: only when a new row was actually inserted.
                if (techSerialId && techTestDateTime) {
                    const newRow = {
                        id: techSerialId,
                        order_db_id: null,
                        test_date_time: techTestDateTime,
                        shipping_tracking_number: scannedTracking,
                        serial_number: '',
                        tested_by: testedBy,
                        order_id: null,
                        product_title: 'Unknown Product',
                        item_number: null,
                        sku: null,
                        condition: null,
                        notes: null,
                        account_source: null,
                        quantity: null,
                        is_shipped: false,
                        ship_by_date: null,
                        created_at: null,
                        out_of_stock: null,
                    };
                    await prependToTechLogsCache(testedBy, newRow);
                    await publishTechLogChanged({
                        techId: testedBy,
                        action: 'insert',
                        rowId: techSerialId,
                        row: newRow,
                        source: 'tech.scan-tracking',
                    });
                }

                return NextResponse.json({
                    success: true,
                    found: true,
                    orderFound: false,
                    techSerialId,
                    warning: (!isFbaLikeTracking || !fnskuFound)
                        ? 'Tracking number not found in orders. Added to exceptions.'
                        : 'FBA/FNSKU processed without exception.',
                    order: {
                        id: null,
                        orderId: 'N/A',
                        productTitle: 'Unknown Product',
                        itemNumber: null,
                        sku: 'N/A',
                        condition: 'N/A',
                        notes: 'Tracking recorded in orders_exceptions for reconciliation',
                        tracking: scannedTracking,
                        serialNumbers: parseSerials(serialSource),
                        testDateTime: techTestDateTime,
                        testedBy,
                        accountSource: null,
                        quantity: 1,
                        status: null,
                        statusHistory: [],
                        isShipped: false,
                        packerId: null,
                        testerId: null,
                        outOfStock: null,
                        shipByDate: null,
                        orderDate: null,
                        createdAt: null
                    }
                });
            }

            // Create tracking row once if missing. This is the single row that serial scans append to.
            let techSerialId: number | null = null;
            let techTestDateTime: string | null = null;

            if (existingTracking.rows.length === 0) {
                const insertResult = await client.query(
                    `INSERT INTO tech_serial_numbers (
                        shipment_id, scan_ref, serial_number, test_date_time, tested_by
                    ) VALUES ($1, $2, $3, date_trunc('second', NOW()), $4)
                    RETURNING id, test_date_time::text`,
                    [resolvedScan.shipmentId, resolvedScan.scanRef, '', testedBy]
                );
                techSerialId = insertResult.rows[0]?.id ?? null;
                techTestDateTime = insertResult.rows[0]?.test_date_time ?? null;
            }
            const serialNumbers = parseSerials(existingTracking.rows[0]?.serial_number);

            await client.query('COMMIT');

            // Surgical Redis cache update for brand-new rows only.
            if (techSerialId && techTestDateTime) {
                const newRow = {
                    id: techSerialId,
                    order_db_id: row.id ?? null,
                    test_date_time: techTestDateTime,
                    shipping_tracking_number: trackingValue,
                    serial_number: '',
                    tested_by: testedBy,
                    order_id: row.order_id ?? null,
                    product_title: row.product_title ?? null,
                    item_number: row.item_number ?? null,
                    sku: row.sku ?? null,
                    condition: row.condition ?? null,
                    notes: row.notes ?? null,
                    account_source: row.account_source ?? null,
                    quantity: row.quantity ?? null,
                    is_shipped: row.is_shipped ?? false,
                    ship_by_date: row.ship_by_date ?? null,
                    created_at: row.created_at ?? null,
                    out_of_stock: row.out_of_stock ?? null,
                };
                await prependToTechLogsCache(testedBy, newRow);
                await publishTechLogChanged({
                    techId: testedBy,
                    action: 'insert',
                    rowId: techSerialId,
                    row: newRow,
                    source: 'tech.scan-tracking',
                });
            }

            await publishOrderTested({
                orderId: Number(row.id),
                testedBy,
                source: 'tech.scan-tracking',
            });

            return NextResponse.json({
                success: true,
                found: true,
                orderFound: true,
                techSerialId,
                order: {
                    id: row.id,
                    shipmentId: resolvedScan.shipmentId ?? null,
                    orderId: row.order_id || 'N/A',
                    productTitle: row.product_title || 'Unknown Product',
                    itemNumber: row.item_number || null,
                    sku: row.sku || 'N/A',
                    condition: row.condition || 'N/A',
                    notes: row.notes || '',
                    tracking: trackingValue,
                    serialNumbers,
                    testDateTime: null,
                    testedBy,
                    accountSource: row.account_source || null,
                    quantity: row.quantity || 1,
                    status: row.status || null,
                    statusHistory: row.status_history || [],
                    isShipped: row.is_shipped || false,
                    packerId: row.packer_id || null,
                    testerId: row.tester_id || null,
                    outOfStock: row.out_of_stock || null,
                    shipByDate: row.ship_by_date || null,
                    orderDate: row.order_date || null,
                    createdAt: row.created_at || null
                }
            });
        } catch (txError) {
            await client.query('ROLLBACK');
            throw txError;
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Error scanning tracking:', error);
        return NextResponse.json({
            success: false,
            found: false,
            error: 'Failed to scan tracking',
            details: error.message
        }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        success: false,
        error: 'Method not allowed. Use POST /api/tech/scan-tracking'
    }, { status: 405 });
}
