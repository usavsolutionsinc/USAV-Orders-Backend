import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { classifyScan } from '@/utils/packer';
import { normalizeSku } from '@/utils/sku';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';
import { normalizeTrackingKey18, normalizeTrackingLast8 } from '@/lib/tracking-format';
import { normalizeTrackingNumber } from '@/lib/shipping/normalize';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { formatPSTTimestamp, normalizePSTTimestamp, getCurrentPSTDateKey } from '@/utils/date';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { createStationActivityLog } from '@/lib/station-activity';
import { publishOrderChanged, publishPackerLogChanged } from '@/lib/realtime/publish';

const LEGACY_PACKER_ALIAS_TO_STAFF_ID: Record<string, number> = {
    '1': 4,
    '2': 5,
    '3': 6,
};

function resolvePackerStaffId(rawId: string | number | null | undefined): number | null {
    const normalized = String(rawId ?? '').trim();
    if (!normalized) return null;

    if (LEGACY_PACKER_ALIAS_TO_STAFF_ID[normalized]) {
        return LEGACY_PACKER_ALIAS_TO_STAFF_ID[normalized];
    }

    const numeric = Number(normalized);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/** Compute Mon–Fri PST week range from the current server time. */
function getCurrentPSTWeekRange(): { startStr: string; endStr: string } {
    const dateKey = getCurrentPSTDateKey();
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
 * Prepend a single new PackerRecord to the current week's Redis cache for this
 * packer (keyed by staffId + week) without invalidating the whole list.
 */
async function prependToPackerLogsCache(staffId: number, newRecord: Record<string, unknown>) {
    const { startStr, endStr } = getCurrentPSTWeekRange();
    const cacheKey = createCacheLookupKey({
        packerId: String(staffId),
        limit: 1000,
        offset: 0,
        weekStart: startStr,
        weekEnd: endStr,
    });
    const existing = await getCachedJson<any[]>('api:packing-logs', cacheKey);
    if (Array.isArray(existing)) {
        await setCachedJson(
            'api:packing-logs',
            cacheKey,
            [newRecord, ...existing].slice(0, 1000),
            120,
            ['packing-logs'],
        );
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';
    const staffId = resolvePackerStaffId(packerId);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    if (!staffId) {
        return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
    }
    const cacheLookup = createCacheLookupKey({ packerId: String(staffId), limit, offset });

    try {
        const cached = await getCachedJson<any[]>('api:packing-logs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        const result = await pool.query(`
            SELECT
                pl.id,
                pl.created_at as timestamp,
                COALESCE(stn.tracking_number_raw, pl.scan_ref) AS tracking,
                pl.tracking_type,
                o.product_title as title
            FROM packer_logs pl
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = pl.shipment_id
            LEFT JOIN orders o ON o.shipment_id = pl.shipment_id AND pl.shipment_id IS NOT NULL
            WHERE pl.packed_by = $1
            ORDER BY pl.id DESC
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

        // Map to format expected by StationHistory (include all fields for compatibility)
        const formattedLogs = result.rows.map((log: any) => ({
            id: `packer${staffId}-${log.id}`,
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            trackingNumber: log.tracking || '',
            title: log.title || '',
            product: log.title || '',
            packedAt: log.timestamp,
            trackingType: log.tracking_type || '',
        }));

        await setCachedJson('api:packing-logs', cacheLookup, formattedLogs, 300, ['packing-logs', 'packing-logs']);
        return NextResponse.json(formattedLogs, { headers: { 'x-cache': 'MISS' } });
    } catch (error: any) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, photos, packerId, createdAt, timestamp, packerName } = body;
        const scanInput = String(trackingNumber || '').trim();
        if (!scanInput) {
            return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
        }
        
        console.log('Received packing request:', {
            trackingNumber,
            photosCount: photos?.length,
            packerId,
            createdAt: createdAt ?? timestamp,
        });
        const staffId = resolvePackerStaffId(packerId);

        if (!staffId) {
            return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
        }
        
        // createdAt is preferred (explicit packer_logs.created_at); timestamp is the legacy field name
        const packDateTime = normalizePSTTimestamp(normalizeScanTimestamp(createdAt ?? timestamp), { fallbackToNow: true })!;
        
        const photoUrls: string[] = Array.isArray(photos) ? photos.filter((u: any) => typeof u === 'string' && u.trim()) : [];

        console.log('=== PACKING UPDATE DEBUG ===');
        console.log('Photos received:', photos);
        console.log('Update parameters:', {
            staffId,
            packDateTime,
            trackingNumber,
            photosCount: photos?.length,
            status: 'shipped'
        });
        
        const classification = classifyScan(scanInput);

        const staffNameResult = await pool.query(
            `SELECT name FROM staff WHERE id = $1 LIMIT 1`,
            [staffId]
        );
        const fallbackPackerName = String(packerName || '').trim() || null;
        const staffName = staffNameResult.rows[0]?.name || fallbackPackerName;

        if (classification.trackingType === 'ORDERS') {
            const trackingLast8 = normalizeTrackingLast8(scanInput);
            if (!trackingLast8 || trackingLast8.length < 8) {
                return NextResponse.json({ error: 'Invalid tracking number' }, { status: 400 });
            }
            const normalizedInput = normalizeTrackingNumber(scanInput);
            // Primary: exact normalized match via shipment_id FK (fast)
            let orderLookup = await pool.query(
                `SELECT o.id, o.order_id, stn.tracking_number_raw AS tracking_number, o.shipment_id,
                        o.product_title, o.condition, o.quantity, o.sku
                 FROM   orders o
                 JOIN   shipping_tracking_numbers stn ON stn.id = o.shipment_id
                 WHERE  stn.tracking_number_normalized = $1
                 ORDER BY o.id DESC
                 LIMIT 1`,
                [normalizedInput]
            );

            // Fallback 1: key18 suffix match (more specific than last8)
            if (orderLookup.rows.length === 0) {
                orderLookup = await pool.query(
                    `SELECT o.id, o.order_id, s.tracking_number_raw AS tracking_number, o.shipment_id,
                            o.product_title, o.condition, o.quantity, o.sku
                     FROM   shipping_tracking_numbers s
                     JOIN   orders o ON o.shipment_id = s.id
                     WHERE  RIGHT(regexp_replace(UPPER(s.tracking_number_normalized), '[^A-Z0-9]', '', 'g'), 18) = $1
                     ORDER BY o.id DESC
                     LIMIT 1`,
                    [normalizeTrackingKey18(scanInput)]
                );
            }

            // Fallback 2: last-8 digit suffix match (handles barcode with 420-zip prefix, etc.)
            if (orderLookup.rows.length === 0) {
                orderLookup = await pool.query(
                    `SELECT o.id, o.order_id, stn.tracking_number_raw AS tracking_number, o.shipment_id,
                            o.product_title, o.condition, o.quantity, o.sku
                     FROM   orders o
                     JOIN   shipping_tracking_numbers stn ON stn.id = o.shipment_id
                     WHERE  RIGHT(regexp_replace(stn.tracking_number_normalized, '[^0-9]', '', 'g'), 8) = $1
                     ORDER BY o.id DESC
                     LIMIT 1`,
                    [trackingLast8]
                );
            }

            if (orderLookup.rows.length === 0) {
                const upsertResult = await upsertOpenOrderException({
                    shippingTrackingNumber: scanInput,
                    sourceStation: 'packer',
                    staffId,
                    staffName,
                    reason: 'not_found',
                    notes: 'Packer scan: tracking not found in orders',
                });
                const ordersExceptionId = upsertResult.exception?.id ?? null;

                const { shipmentId: nfShipmentId, scanRef: nfScanRef } = await resolveShipmentId(scanInput);

                // Check for an existing row by shipment_id or scan_ref last-8 to avoid duplicates
                const nfExisting = await pool.query(`
                    SELECT id, created_at::text
                    FROM packer_logs
                    WHERE (shipment_id IS NOT NULL AND shipment_id = $1)
                       OR (shipment_id IS NULL AND scan_ref IS NOT NULL
                           AND RIGHT(regexp_replace(UPPER(scan_ref), '[^A-Z0-9]', '', 'g'), 8) = $2)
                    ORDER BY id DESC LIMIT 1
                `, [nfShipmentId, trackingLast8]);

                let notFoundPackerLogId: number | null;
                let notFoundCreatedAt: string;
                if (nfExisting.rows.length > 0) {
                    notFoundPackerLogId = nfExisting.rows[0].id;
                    notFoundCreatedAt = nfExisting.rows[0].created_at ?? packDateTime;
                    await pool.query(
                        `UPDATE packer_logs SET updated_at = NOW(), packed_by = $2 WHERE id = $1`,
                        [notFoundPackerLogId, staffId]
                    );
                } else {
                    const notFoundInsert = await pool.query(`
                        INSERT INTO packer_logs (
                            shipment_id,
                            scan_ref,
                            tracking_type,
                            created_at,
                            packed_by
                        ) VALUES ($1, $2, $3, $4, $5)
                        RETURNING id, created_at::text
                    `, [nfShipmentId, nfScanRef, classification.trackingType, packDateTime, staffId]);
                    notFoundPackerLogId = notFoundInsert.rows[0]?.id ?? null;
                    notFoundCreatedAt = notFoundInsert.rows[0]?.created_at ?? packDateTime;
                }

                if (notFoundPackerLogId && photoUrls.length > 0) {
                    for (const url of photoUrls) {
                        await pool.query(
                            `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
                             VALUES ('PACKER_LOG', $1, $2, $3, 'box_label')
                             ON CONFLICT (entity_type, entity_id, url) DO NOTHING`,
                            [notFoundPackerLogId, url, staffId]
                        );
                    }
                }

                const notFoundRecord = {
                    id: notFoundPackerLogId,
                    created_at: notFoundCreatedAt,
                    tracking_number: scanInput,
                    packed_by: staffId,
                    order_id: null,
                    product_title: null,
                    condition: null,
                    quantity: null,
                    sku: null,
                };

                await createStationActivityLog(pool, {
                    station: 'PACK',
                    activityType: 'PACK_COMPLETED',
                    staffId,
                    shipmentId: nfShipmentId ?? null,
                    scanRef: nfScanRef ?? scanInput,
                    ordersExceptionId,
                    packerLogId: notFoundPackerLogId,
                    notes: 'Pack scan not matched to order',
                    metadata: {
                        tracking_type: classification.trackingType,
                        tracking: scanInput,
                    },
                    createdAt: notFoundCreatedAt,
                });

                await invalidateCacheTags(['packing-logs', 'orders', 'orders-next', 'shipped']);
                if (notFoundRecord.id) await prependToPackerLogsCache(staffId, notFoundRecord);

                return NextResponse.json({
                    success: true,
                    warning: 'Order not found in orders. Added to exceptions queue.',
                    trackingType: classification.trackingType,
                    shippingTrackingNumber: scanInput,
                    packedBy: staffId,
                    packDateTime,
                    packerRecord: notFoundRecord,
                    photosCount: Array.isArray(photos) ? photos.length : 0,
                });
            }

            const order = orderLookup.rows[0];

            // Update status only — shipped state is derived from shipping_tracking_numbers
            await pool.query(`
                UPDATE orders
                SET status = 'shipped'
                WHERE id = $1
                  AND (status IS NULL OR status != 'shipped')
            `, [order.id]);

            // Upsert a PACK work_assignment as DONE.
            // completed_by_packer_id records the scanner-station actor (staffId).
            await pool.query(`
                INSERT INTO work_assignments
                    (entity_type, entity_id, work_type, assigned_packer_id,
                     completed_by_packer_id, status, priority, notes, completed_at)
                VALUES ('ORDER', $1, 'PACK', $2, $2, 'DONE', 100, 'Auto-completed on pack scan', NOW())
                ON CONFLICT (entity_type, entity_id, work_type)
                    WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
                DO UPDATE
                    SET assigned_packer_id     = EXCLUDED.assigned_packer_id,
                        completed_by_packer_id = EXCLUDED.completed_by_packer_id,
                        status                 = 'DONE',
                        completed_at           = NOW(),
                        updated_at             = NOW()
            `, [order.id, staffId]);

            const orderShipmentId: number | null = order.shipment_id ?? null;

            // Check for an existing row by shipment_id to avoid duplicate rows on re-scan
            const foundExisting = await pool.query(`
                SELECT id, created_at::text
                FROM packer_logs
                WHERE shipment_id = $1
                ORDER BY id DESC LIMIT 1
            `, [orderShipmentId]);

            let foundPackerLogId: number | null;
            let foundCreatedAt: string;
            if (foundExisting.rows.length > 0) {
                foundPackerLogId = foundExisting.rows[0].id;
                foundCreatedAt = foundExisting.rows[0].created_at ?? packDateTime;
                await pool.query(
                    `UPDATE packer_logs SET updated_at = NOW(), packed_by = $2 WHERE id = $1`,
                    [foundPackerLogId, staffId]
                );
            } else {
                const foundInsert = await pool.query(`
                    INSERT INTO packer_logs (
                        shipment_id,
                        scan_ref,
                        tracking_type,
                        created_at,
                        packed_by
                    ) VALUES ($1, NULL, $2, $3, $4)
                    RETURNING id, created_at::text
                `, [orderShipmentId, classification.trackingType, packDateTime, staffId]);
                foundPackerLogId = foundInsert.rows[0]?.id ?? null;
                foundCreatedAt = foundInsert.rows[0]?.created_at ?? packDateTime;
            }

            if (foundPackerLogId && photoUrls.length > 0) {
                for (const url of photoUrls) {
                    await pool.query(
                        `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
                         VALUES ('PACKER_LOG', $1, $2, $3, 'box_label')
                         ON CONFLICT (entity_type, entity_id, url) DO NOTHING`,
                        [foundPackerLogId, url, staffId]
                    );
                }
            }

            const foundRecord = {
                id: foundPackerLogId,
                created_at: foundCreatedAt,
                tracking_number: order.tracking_number ?? null,
                packed_by: staffId,
                order_id: order.order_id ?? null,
                product_title: order.product_title ?? null,
                condition: order.condition ?? null,
                quantity: order.quantity ?? null,
                sku: order.sku ?? null,
            };

            await createStationActivityLog(pool, {
                station: 'PACK',
                activityType: 'PACK_COMPLETED',
                staffId,
                shipmentId: orderShipmentId,
                scanRef: order.tracking_number ?? scanInput,
                packerLogId: foundPackerLogId,
                notes: 'Order packed successfully',
                metadata: {
                    tracking_type: classification.trackingType,
                    order_id: order.order_id ?? null,
                },
                createdAt: foundCreatedAt,
            });

            await invalidateCacheTags(['packing-logs', 'orders', 'orders-next', 'shipped']);
            if (foundRecord.id) await prependToPackerLogsCache(staffId, foundRecord);

            // Broadcast to all devices so UpNext + PendingOrdersTable update instantly
            await Promise.allSettled([
                publishOrderChanged({ orderIds: [order.id], source: 'packing-logs' }),
                publishPackerLogChanged({
                    packerId: staffId,
                    action: 'insert',
                    packerLogId: foundPackerLogId ?? undefined,
                    source: 'packing-logs',
                }),
            ]);

            return NextResponse.json({
                success: true,
                trackingType: classification.trackingType,
                orderId: order.order_id,
                productTitle: order.product_title,
                condition: order.condition,
                trackingNumber: order.tracking_number ?? null,
                packedBy: staffId,
                packDateTime,
                packerRecord: foundRecord,
                photosCount: Array.isArray(photos) ? photos.length : 0,
                message: 'Order packed successfully',
            });
        }

        // Non-order scans (SKU, FNSKU, etc.): store raw input in scan_ref
        const nonOrderInsert = await pool.query(`
            INSERT INTO packer_logs (
                scan_ref,
                shipment_id,
                tracking_type,
                created_at,
                packed_by
            ) VALUES ($1, NULL, $2, $3, $4)
            RETURNING id, created_at::text
        `, [classification.normalizedInput, classification.trackingType, packDateTime, staffId]);

        const nonOrderPackerLogId = nonOrderInsert.rows[0]?.id ?? null;
        if (nonOrderPackerLogId && photoUrls.length > 0) {
            for (const url of photoUrls) {
                    await pool.query(
                        `INSERT INTO photos (entity_type, entity_id, url, taken_by_staff_id, photo_type)
                         VALUES ('PACKER_LOG', $1, $2, $3, 'box_label')
                         ON CONFLICT (entity_type, entity_id, url) DO NOTHING`,
                        [nonOrderPackerLogId, url, staffId]
                    );
            }
        }

        const nonOrderRecord = {
            id: nonOrderPackerLogId,
            created_at: nonOrderInsert.rows[0]?.created_at ?? packDateTime,
            tracking_number: classification.normalizedInput,
            packed_by: staffId,
            order_id: null,
            product_title: null,
            condition: null,
            quantity: null,
            sku: null,
        };

        await createStationActivityLog(pool, {
            station: 'PACK',
            activityType: 'PACK_SCAN',
            staffId,
            scanRef: classification.normalizedInput,
            packerLogId: nonOrderPackerLogId,
            notes: `Pack ${classification.trackingType} scan`,
            metadata: {
                tracking_type: classification.trackingType,
            },
            createdAt: nonOrderInsert.rows[0]?.created_at ?? packDateTime,
        });

        let skuUpdated = false;
        if (classification.trackingType === 'SKU' && classification.skuBase) {
            const addQty = classification.skuQty || 1;
            const normalizedBase = normalizeSku(classification.skuBase || '');

            const skuRows = await pool.query('SELECT id, stock, sku, product_title FROM sku_stock');
            const target = skuRows.rows.find(
                (r: any) => normalizeSku(String(r.sku || '')) === normalizedBase
            );

            const resolvedTitle: string | null = target?.product_title || null;

            if (target) {
                const currentQty = parseInt(target.stock || '0', 10) || 0;
                const nextQty = Math.max(0, currentQty + addQty);
                await pool.query(
                    `UPDATE sku_stock
                     SET stock = $1,
                         product_title = COALESCE(product_title, $2)
                     WHERE id = $3`,
                    [String(nextQty), resolvedTitle, target.id]
                );
            } else {
                await pool.query(
                    `INSERT INTO sku_stock (stock, sku, product_title)
                     VALUES ($1, $2, $3)`,
                    [String(Math.max(0, addQty)), normalizedBase, resolvedTitle]
                );
            }
            skuUpdated = true;
        }

        await invalidateCacheTags(['packing-logs', 'orders', 'orders-next', 'shipped']);
        if (nonOrderRecord.id) await prependToPackerLogsCache(staffId, nonOrderRecord);

        return NextResponse.json({
            success: true,
            trackingType: classification.trackingType,
            shippingTrackingNumber: classification.normalizedInput,
            packedBy: staffId,
            packDateTime,
            packerRecord: nonOrderRecord,
            photosCount: Array.isArray(photos) ? photos.length : 0,
            skuUpdated,
        });
    } catch (error: any) {
        console.error('Error updating order:', error);
        return NextResponse.json({ 
            error: 'Failed to update order', 
            details: error.message 
        }, { status: 500 });
    }
}

function normalizeScanTimestamp(input: any): string | null {
    if (!input) return null;
    const raw = String(input).trim();
    if (!raw) return null;

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
        return raw;
    }

    if (raw.includes('/')) {
        const cleaned = raw.replace(',', '');
        const [datePart, timePart] = cleaned.split(' ');
        if (!datePart || !timePart) return null;
        const [m, d, y] = datePart.split('/').map(Number);
        const [h, min, s] = timePart.split(':').map(Number);
        if (!m || !d || !y) return null;
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h || 0).padStart(2, '0')}:${String(min || 0).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`;
    }
    return normalizePSTTimestamp(raw);
}
