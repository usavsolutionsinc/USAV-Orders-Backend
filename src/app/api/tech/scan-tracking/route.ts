import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getApiIdempotencyResponse, readIdempotencyKey, saveApiIdempotencyResponse } from '@/lib/api-idempotency';
import { createStationScanSession } from '@/lib/station-scan-session';
import { normalizeTrackingKey18, normalizeTrackingLast8 } from '@/lib/tracking-format';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';
import { checkRateLimit } from '@/lib/api-guard';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { formatPSTTimestamp } from '@/utils/date';
import { publishOrderTested, publishTechLogChanged } from '@/lib/realtime/publish';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { looksLikeFnsku } from '@/lib/scan-resolver';
import { mergeSerialsFromTsnRows } from '@/lib/tech/serialFields';
import { performTechFnskuScan } from '@/lib/tech/performTechFnskuScan';

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

    let parsed: { tracking?: string; techId?: string | number; idempotencyKey?: string };
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

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey);
    if (idemKey) {
        const cached = await getApiIdempotencyResponse(pool, idemKey, 'tech.scan-tracking');
        if (cached && cached.status_code === 200) {
            return NextResponse.json(cached.response_body, { status: 200 });
        }
    }

    try {
        const scannedTracking = String(tracking || '').trim();
        const key18 = normalizeTrackingKey18(scannedTracking);
        if (!key18) {
            return NextResponse.json({ success: false, found: false, error: 'Invalid tracking number' }, { status: 400 });
        }
        /** Full X0... / B0... scans always use the FNSKU ledger path, never order/TSN key18 dedup. */
        const skipOrderAndTsnMatchForFnsku = looksLikeFnsku(scannedTracking);
        const trackingLast8 = normalizeTrackingLast8(scannedTracking);
        const normalizedLast8 = /^\d{8}$/.test(trackingLast8) ? trackingLast8 : null;
        const resolvedScan = await resolveShipmentId(scannedTracking);
        const techIdNum = parseInt(techId, 10);
        if (!techIdNum) {
            return NextResponse.json({ success: false, found: false, error: 'Invalid Tech ID' }, { status: 400 });
        }

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
            const result = skipOrderAndTsnMatchForFnsku
                ? { rows: [] as Record<string, unknown>[] }
                : await client.query(`
                SELECT
                    o.id,
                    o.shipment_id,
                    o.order_id,
                    o.product_title,
                    o.item_number,
                    o.sku,
                    o.condition,
                    o.notes,
                    COALESCE(stn.tracking_number_raw, stn_any.tracking_number_raw) AS shipping_tracking_number,
                    o.account_source,
                    o.status,
                    o.status_history,
                    COALESCE(
                        stn.is_carrier_accepted OR stn.is_in_transit OR stn.is_out_for_delivery OR stn.is_delivered,
                        stn_any.is_carrier_accepted OR stn_any.is_in_transit OR stn_any.is_out_for_delivery OR stn_any.is_delivered,
                        false
                    ) AS is_shipped,
                    o.out_of_stock,
                    to_char(wa_deadline.deadline_at, 'YYYY-MM-DD') AS ship_by_date,
                    o.order_date,
                    o.created_at,
                    o.quantity,
                    wa_test.assigned_tech_id   AS tester_id,
                    wa_pack.assigned_packer_id AS packer_id
                FROM orders o
                LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                -- Fallback join: find any stn row matching key18 in case the order's
                -- shipment_id is null or points to a different (legacy) row
                LEFT JOIN LATERAL (
                    SELECT s.id, s.tracking_number_raw,
                           s.is_carrier_accepted, s.is_in_transit,
                           s.is_out_for_delivery, s.is_delivered
                    FROM shipping_tracking_numbers s
                    WHERE RIGHT(regexp_replace(UPPER(s.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $2
                       OR (
                         $3::text IS NOT NULL
                         AND RIGHT(regexp_replace(COALESCE(s.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $3
                       )
                    ORDER BY s.id DESC
                    LIMIT 1
                ) stn_any ON TRUE
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
                    -- Direct match via resolved shipment ID
                    $1::bigint IS NOT NULL
                    AND o.shipment_id = $1
                ) OR (
                    -- Order's linked stn row matches key18
                    stn.id IS NOT NULL
                    AND (
                      RIGHT(regexp_replace(UPPER(stn.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $2
                      OR (
                        $3::text IS NOT NULL
                        AND RIGHT(regexp_replace(COALESCE(stn.tracking_number_normalized, ''), '[^0-9]', '', 'g'), 8) = $3
                      )
                    )
                ) OR (
                    -- Independent stn lookup matched and this order's shipment_id points to it
                    stn_any.id IS NOT NULL
                    AND o.shipment_id = stn_any.id
                )
                ORDER BY
                    CASE WHEN $1::bigint IS NOT NULL AND o.shipment_id = $1 THEN 0
                         WHEN stn.id IS NOT NULL THEN 1
                         ELSE 2 END,
                    o.id DESC
                LIMIT 1
            `, [resolvedScan.shipmentId, key18, normalizedLast8]);

            // Check tech_serial_numbers for existing tracking entry
            const existingTracking = skipOrderAndTsnMatchForFnsku
                ? { rows: [] as Record<string, unknown>[] }
                : await client.query(
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
                    AND (
                      RIGHT(regexp_replace(UPPER(tsn.scan_ref), '[^A-Z0-9]', '', 'g'), 18) = $2
                      OR (
                        $3::text IS NOT NULL
                        AND RIGHT(regexp_replace(COALESCE(tsn.scan_ref, ''), '[^0-9]', '', 'g'), 8) = $3
                      )
                    )
                 ) OR (
                    tsn.orders_exception_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1 FROM orders_exceptions oe
                        WHERE oe.id = tsn.orders_exception_id
                          AND oe.status = 'open'
                          AND (
                            RIGHT(regexp_replace(UPPER(COALESCE(oe.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $2
                            OR (
                              $3::text IS NOT NULL
                              AND RIGHT(regexp_replace(COALESCE(oe.shipping_tracking_number, ''), '[^0-9]', '', 'g'), 8) = $3
                            )
                          )
                    )
                 )
                 ORDER BY tsn.id ASC`,
                [resolvedScan.shipmentId, key18, normalizedLast8]
            );

            const row = result.rows[0] || null;
            // Prefer the order's own shipment_id, then fall back to resolvedScan
            const matchedShipmentId =
                row?.shipment_id != null
                    ? Number(row.shipment_id)
                    : (resolvedScan.shipmentId ?? null);
            const trackingValue =
                row?.shipping_tracking_number ||
                existingTracking.rows[0]?.shipping_tracking_number ||
                scannedTracking;

            if (!row) {
                const isFbaLikeTracking = FBA_LIKE_RE.test(scannedTracking);
                const fnskuFound = isFbaLikeTracking
                    ? await hasMatchingFbaFnsku(scannedTracking, client)
                    : false;
                let ordersExceptionId: number | null = null;

                if (!isFbaLikeTracking || !fnskuFound) {
                    const upsertResult = await upsertOpenOrderException({
                        shippingTrackingNumber: scannedTracking,
                        sourceStation: 'tech',
                        staffId: testedBy,
                        staffName: testedByName,
                        reason: 'not_found',
                        notes: isFbaLikeTracking
                            ? 'Tech scan: FNSKU not found in fba_fnskus'
                            : 'Tech scan: tracking not found in orders',
                    }, client);
                    ordersExceptionId = upsertResult.exception?.id ?? null;
                }

                if (isFbaLikeTracking && fnskuFound) {
                    const normalizedFnsku = scannedTracking.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                    try {
                        const payload = await performTechFnskuScan(client, {
                            fnsku: normalizedFnsku,
                            testedBy,
                        });
                        await client.query('COMMIT');
                        await invalidateCacheTags(['orders', 'orders-next', 'tech-logs']);
                        await publishTechLogChanged({
                            techId: testedBy,
                            action: 'insert',
                            rowId: payload.fnskuLogId,
                            source: 'tech.scan-tracking',
                        });
                        const fnskuBody: Record<string, unknown> = {
                            success: true,
                            found: true,
                            orderFound: false,
                            techSerialId: null,
                            techActivityId: payload.fnskuSalId,
                            fnskuLogId: payload.fnskuLogId,
                            warning: 'FBA/FNSKU loaded.',
                            order: {
                                id: payload.order.id,
                                orderId: payload.order.orderId,
                                productTitle: payload.order.productTitle,
                                itemNumber: payload.order.itemNumber,
                                sku: payload.order.sku,
                                condition: payload.order.condition,
                                notes: payload.order.notes,
                                tracking: payload.order.tracking,
                                serialNumbers: payload.order.serialNumbers,
                                testDateTime: payload.order.testDateTime,
                                testedBy: payload.order.testedBy,
                                accountSource: payload.order.accountSource,
                                quantity: payload.order.quantity,
                                status: payload.order.status,
                                statusHistory: payload.order.statusHistory,
                                isShipped: payload.order.isShipped,
                                packerId: payload.order.packerId,
                                testerId: payload.order.testerId,
                                outOfStock: payload.order.outOfStock,
                                shipByDate: payload.order.shipByDate,
                                orderDate: payload.order.orderDate,
                                createdAt: payload.order.createdAt,
                                asin: payload.order.asin,
                            },
                        };
                        const scanSessionIdFnsku = await createStationScanSession(pool, {
                            staffId: testedBy,
                            sessionKind: 'FNSKU',
                            fnsku: normalizedFnsku,
                            trackingRaw: String(payload.order.tracking || normalizedFnsku),
                            trackingKey18: normalizeTrackingKey18(normalizedFnsku),
                            scanRef: normalizedFnsku,
                        });
                        const fnskuOut = { ...fnskuBody, scanSessionId: scanSessionIdFnsku };
                        if (idemKey) {
                            await saveApiIdempotencyResponse(pool, {
                                idempotencyKey: idemKey,
                                route: 'tech.scan-tracking',
                                staffId: testedBy,
                                statusCode: 200,
                                responseBody: fnskuOut,
                            });
                        }
                        return NextResponse.json(fnskuOut);
                    } catch (scanErr: unknown) {
                        const code = (scanErr as { code?: string })?.code;
                        if (code === 'FNSKU_NOT_FOUND') {
                            await client.query('ROLLBACK');
                            return NextResponse.json(
                                { success: false, found: false, error: 'FNSKU not found in fba_fnskus' },
                                { status: 404 },
                            );
                        }
                        throw scanErr;
                    }
                }

                const existingScanLog = await client.query(
                    `SELECT id, staff_id, created_at::text AS created_at
                     FROM station_activity_logs
                     WHERE station = 'TECH'
                       AND activity_type = 'TRACKING_SCANNED'
                       AND (
                         ($1::bigint IS NOT NULL AND shipment_id = $1)
                         OR RIGHT(regexp_replace(UPPER(COALESCE(scan_ref, metadata->>'tracking', '')), '[^A-Z0-9]', '', 'g'), 18) = $2
                         OR (
                           $3::text IS NOT NULL
                           AND RIGHT(regexp_replace(COALESCE(scan_ref, metadata->>'tracking', ''), '[^0-9]', '', 'g'), 8) = $3
                         )
                       )
                     ORDER BY id DESC
                     LIMIT 1`,
                    [resolvedScan.shipmentId, key18, normalizedLast8]
                );

                let techActivityId: number | null = null;
                let techTestDateTime: string | null = null;
                let isNewSalRow = false;
                const existingScanStaffId = existingScanLog.rows[0]?.staff_id != null
                    ? Number(existingScanLog.rows[0].staff_id)
                    : null;
                const shouldReplaceExistingScan =
                    existingScanLog.rows.length > 0 && existingScanStaffId !== testedBy;

                if (existingScanLog.rows.length === 0 || shouldReplaceExistingScan) {
                    if (shouldReplaceExistingScan) {
                        await client.query(`DELETE FROM station_activity_logs WHERE id = $1`, [existingScanLog.rows[0].id]);
                    }
                    isNewSalRow = true;
                    techTestDateTime = formatPSTTimestamp();
                    techActivityId = await createStationActivityLog(client, {
                        station: 'TECH',
                        activityType: 'TRACKING_SCANNED',
                        staffId: testedBy,
                        shipmentId: resolvedScan.shipmentId ?? null,
                        scanRef: resolvedScan.scanRef ?? scannedTracking,
                        ordersExceptionId,
                        notes: 'Tracking scan without matched order',
                        metadata: {
                            order_found: false,
                            tracking: scannedTracking,
                        },
                        createdAt: techTestDateTime,
                    });
                } else {
                    const updateResult = await client.query(
                        `UPDATE station_activity_logs
                         SET updated_at = date_trunc('second', NOW()),
                             shipment_id = CASE WHEN $2::bigint IS NOT NULL THEN $2 ELSE shipment_id END,
                             scan_ref = $5,
                             notes = COALESCE(notes, $1),
                             orders_exception_id = COALESCE($3, orders_exception_id),
                             metadata = COALESCE(metadata, '{}'::jsonb)
                               || jsonb_build_object('tracking', to_jsonb($5::text))
                         WHERE id = $4
                         RETURNING id, created_at::text AS created_at`,
                        [
                            'Tracking scan without matched order',
                            resolvedScan.shipmentId ?? null,
                            ordersExceptionId,
                            existingScanLog.rows[0].id,
                            scannedTracking,
                        ]
                    );
                    techActivityId = updateResult.rows[0]?.id ?? existingScanLog.rows[0].id ?? null;
                    techTestDateTime = updateResult.rows[0]?.created_at ?? null;
                }

                await client.query('COMMIT');
                await invalidateCacheTags(['orders', 'orders-next', 'tech-logs']); // exceptions upserted above

                if (techActivityId) {
                    await publishTechLogChanged({
                        techId: testedBy,
                        action: isNewSalRow ? 'insert' : 'update',
                        rowId: techActivityId,
                        source: 'tech.scan-tracking',
                    });
                }

                const exceptionBody: Record<string, unknown> = {
                    success: true,
                    found: true,
                    orderFound: false,
                    techSerialId: null,
                    techActivityId,
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
                        serialNumbers: [],
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
                };
                const scanSessionIdExc = await createStationScanSession(pool, {
                    staffId: testedBy,
                    sessionKind: 'EXCEPTION',
                    shipmentId: resolvedScan.shipmentId ?? null,
                    ordersExceptionId,
                    trackingKey18: key18,
                    trackingRaw: scannedTracking,
                    scanRef: resolvedScan.scanRef ?? scannedTracking,
                });
                const exceptionOut = { ...exceptionBody, scanSessionId: scanSessionIdExc };
                if (idemKey) {
                    await saveApiIdempotencyResponse(pool, {
                        idempotencyKey: idemKey,
                        route: 'tech.scan-tracking',
                        staffId: testedBy,
                        statusCode: 200,
                        responseBody: exceptionOut,
                    });
                }
                return NextResponse.json(exceptionOut);
            }

            let techActivityId: number | null = null;
            let techTestDateTime: string | null = null;
            let isNewSalRow = false;

            const existingScanLog = await client.query(
                `SELECT id, staff_id, created_at::text AS created_at
                 FROM station_activity_logs
                 WHERE station = 'TECH'
                   AND activity_type = 'TRACKING_SCANNED'
                   AND (
                     ($1::bigint IS NOT NULL AND shipment_id = $1)
                     OR RIGHT(regexp_replace(UPPER(COALESCE(scan_ref, metadata->>'tracking', '')), '[^A-Z0-9]', '', 'g'), 18) = $2
                     OR (
                       $3::text IS NOT NULL
                       AND RIGHT(regexp_replace(COALESCE(scan_ref, metadata->>'tracking', ''), '[^0-9]', '', 'g'), 8) = $3
                     )
                   )
                 ORDER BY id DESC
                 LIMIT 1`,
                [matchedShipmentId, key18, normalizedLast8]
            );
            const existingScanStaffId = existingScanLog.rows[0]?.staff_id != null
                ? Number(existingScanLog.rows[0].staff_id)
                : null;
            const shouldReplaceExistingScan =
                existingScanLog.rows.length > 0 && existingScanStaffId !== testedBy;

            if (existingScanLog.rows.length === 0 || shouldReplaceExistingScan) {
                if (shouldReplaceExistingScan) {
                    await client.query(`DELETE FROM station_activity_logs WHERE id = $1`, [existingScanLog.rows[0].id]);
                }
                isNewSalRow = true;
                techTestDateTime = formatPSTTimestamp();
                techActivityId = await createStationActivityLog(client, {
                    station: 'TECH',
                    activityType: 'TRACKING_SCANNED',
                    staffId: testedBy,
                    shipmentId: matchedShipmentId,
                    scanRef: resolvedScan.scanRef ?? scannedTracking,
                    metadata: {
                        order_found: true,
                        order_id: row.order_id ?? null,
                        tracking: trackingValue,
                    },
                    createdAt: techTestDateTime,
                });
            } else {
                const orderIdForMeta =
                    row.order_id != null && row.order_id !== ''
                        ? String(row.order_id)
                        : null;
                const updateResult = await client.query(
                    `UPDATE station_activity_logs
                     SET updated_at = date_trunc('second', NOW()),
                         staff_id = $1,
                         shipment_id = CASE WHEN $2::bigint IS NOT NULL THEN $2 ELSE shipment_id END,
                         scan_ref = $4,
                         metadata = COALESCE(metadata, '{}'::jsonb)
                           || jsonb_build_object(
                             'tracking', to_jsonb($5::text),
                             'order_found', 'true'::jsonb
                           )
                           || CASE
                             WHEN $6::text IS NOT NULL AND BTRIM($6::text) <> ''
                             THEN jsonb_build_object('order_id', to_jsonb($6::text))
                             ELSE '{}'::jsonb
                           END
                     WHERE id = $3
                     RETURNING id, created_at::text AS created_at`,
                    [
                        testedBy,
                        matchedShipmentId,
                        existingScanLog.rows[0].id,
                        scannedTracking,
                        trackingValue,
                        orderIdForMeta,
                    ]
                );
                techActivityId = updateResult.rows[0]?.id ?? existingScanLog.rows[0].id ?? null;
                techTestDateTime = updateResult.rows[0]?.created_at ?? null;
            }
            const serialNumbers = mergeSerialsFromTsnRows(existingTracking.rows);
            const techSerialRowIds = existingTracking.rows
                .map((r) => Number((r as { id?: unknown }).id))
                .filter((id) => Number.isFinite(id) && id > 0);
            const techSerialIdForPayload =
                techSerialRowIds.length > 0 ? Math.max(...techSerialRowIds) : null;

            await client.query('COMMIT');

            await invalidateCacheTags(['orders', 'orders-next', 'tech-logs']);

            if (techActivityId) {
                await publishTechLogChanged({
                    techId: testedBy,
                    action: isNewSalRow ? 'insert' : 'update',
                    rowId: techActivityId,
                    source: 'tech.scan-tracking',
                });
            }

            await publishOrderTested({
                orderId: Number(row.id),
                testedBy,
                source: 'tech.scan-tracking',
            });

            const orderOkBody: Record<string, unknown> = {
                success: true,
                found: true,
                orderFound: true,
                techSerialId: techSerialIdForPayload,
                techActivityId,
                order: {
                    id: row.id,
                    shipmentId: matchedShipmentId,
                    orderId: row.order_id || 'N/A',
                    productTitle: row.product_title || 'Unknown Product',
                    itemNumber: row.item_number || null,
                    sku: row.sku || 'N/A',
                    condition: row.condition || 'N/A',
                    notes: row.notes || '',
                    tracking: trackingValue,
                    serialNumbers,
                    testDateTime: techTestDateTime,
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
            };
            const scanSessionIdOrder = await createStationScanSession(pool, {
                staffId: testedBy,
                sessionKind: 'ORDER',
                shipmentId: matchedShipmentId,
                trackingKey18: key18,
                trackingRaw: scannedTracking,
                scanRef: resolvedScan.scanRef ?? String(trackingValue),
            });
            const orderOkOut = { ...orderOkBody, scanSessionId: scanSessionIdOrder };
            if (idemKey) {
                await saveApiIdempotencyResponse(pool, {
                    idempotencyKey: idemKey,
                    route: 'tech.scan-tracking',
                    staffId: testedBy,
                    statusCode: 200,
                    responseBody: orderOkOut,
                });
            }
            return NextResponse.json(orderOkOut);
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
