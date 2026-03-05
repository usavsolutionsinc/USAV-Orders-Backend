import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { classifyScan } from '@/utils/packer';
import { normalizeSku } from '@/utils/sku';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';
import { normalizeTrackingLast8 } from '@/lib/tracking-format';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';
import { formatPSTTimestamp } from '@/lib/timezone';

/** Compute Mon–Fri PST week range from the current server time. */
function getCurrentPSTWeekRange(): { startStr: string; endStr: string } {
    const ts = formatPSTTimestamp();
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
    const existing = await getCachedJson<any[]>('api:packerlogs', cacheKey);
    if (Array.isArray(existing)) {
        await setCachedJson(
            'api:packerlogs',
            cacheKey,
            [newRecord, ...existing].slice(0, 1000),
            120,
            ['packerlogs'],
        );
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const cacheLookup = createCacheLookupKey({ packerId, limit, offset });

    try {
        const cached = await getCachedJson<any[]>('api:packing-logs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        // Map packerId directly to staff ID
        // packer_1 (from mobile) -> staff id 4 (Tuan)
        // packer_2 (from mobile) -> staff id 5 (Thuy)
        const packerStaffIds: { [key: string]: number } = {
            '1': 4,  // Tuan
            '2': 5,  // Thuy
            '3': 6   // Future packer (if needed)
        };
        const staffId = packerStaffIds[packerId];

        if (!staffId) {
            return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
        }

        const result = await pool.query(`
            SELECT 
                pl.id,
                pl.pack_date_time as timestamp,
                pl.shipping_tracking_number as tracking,
                pl.tracking_type,
                o.product_title as title
            FROM packer_logs pl
            LEFT JOIN orders o ON o.shipping_tracking_number = pl.shipping_tracking_number
            WHERE pl.packed_by = $1
            ORDER BY pl.id DESC
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

        // Map to format expected by StationHistory (include all fields for compatibility)
        const formattedLogs = result.rows.map((log: any) => ({
            id: `packer${packerId}-${log.id}`,
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            trackingNumber: log.tracking || '',
            title: log.title || '',
            product: log.title || '',
            packedAt: log.timestamp,
            trackingType: log.tracking_type || '',
        }));

        await setCachedJson('api:packing-logs', cacheLookup, formattedLogs, 300, ['packing-logs', 'packerlogs']);
        return NextResponse.json(formattedLogs, { headers: { 'x-cache': 'MISS' } });
    } catch (error: any) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, photos, packerId, timestamp, packerName } = body;
        const scanInput = String(trackingNumber || '').trim();
        if (!scanInput) {
            return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
        }
        
        console.log('Received packing request:', {
            trackingNumber,
            photosCount: photos?.length,
            packerId,
            timestamp
        });
        
        // Map packerId directly to staff ID
        // packer_1 (from mobile) -> staff id 4 (Tuan)
        // packer_2 (from mobile) -> staff id 5 (Thuy)
        const packerStaffIds: { [key: string]: number } = {
            '1': 4,  // Tuan
            '2': 5,  // Thuy
            '3': 6   // Future packer (if needed)
        };
        const staffId = packerStaffIds[packerId];

        if (!staffId) {
            return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
        }
        
        const now = new Date();
        const packDateTime = parseScanTimestamp(timestamp) || now;
        
        // Convert photos array to structured JSONB format
        const photosJsonb = Array.isArray(photos) 
            ? JSON.stringify(photos.map((url, index) => ({
                url,
                index: index + 1,
                uploadedAt: now.toISOString()
              })))
            : '[]';
        
        console.log('=== PACKING UPDATE DEBUG ===');
        console.log('Photos received:', photos);
        console.log('Photos JSONB:', photosJsonb);
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
            const orderLookup = await pool.query(
                `SELECT id, order_id, shipping_tracking_number, product_title, condition, quantity, sku
                 FROM orders
                 WHERE shipping_tracking_number IS NOT NULL
                   AND shipping_tracking_number != ''
                   AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
                 ORDER BY id DESC
                 LIMIT 1`,
                [trackingLast8]
            );

            if (orderLookup.rows.length === 0) {
                await upsertOpenOrderException({
                    shippingTrackingNumber: scanInput,
                    sourceStation: 'packer',
                    staffId,
                    staffName,
                    reason: 'not_found',
                    notes: 'Packer scan: tracking not found in orders',
                });

                const notFoundInsert = await pool.query(`
                    INSERT INTO packer_logs (
                        shipping_tracking_number,
                        tracking_type,
                        pack_date_time,
                        packed_by,
                        packer_photos_url
                    ) VALUES ($1, $2, $3, $4, $5::jsonb)
                    RETURNING id, pack_date_time::text
                `, [scanInput, classification.trackingType, packDateTime, staffId, photosJsonb]);

                const notFoundRecord = {
                    id: notFoundInsert.rows[0]?.id ?? null,
                    pack_date_time: notFoundInsert.rows[0]?.pack_date_time ?? packDateTime,
                    shipping_tracking_number: scanInput,
                    packed_by: staffId,
                    order_id: null,
                    product_title: null,
                    condition: null,
                    quantity: null,
                    sku: null,
                    packer_photos_url: [],
                };

                await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
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

            // Mark the order shipped
            await pool.query(`
                UPDATE orders
                SET is_shipped = true,
                    status = 'shipped'
                WHERE id = $1
                  AND is_shipped = false
            `, [order.id]);

            // Upsert a PACK work_assignment as DONE.
            // If an active (ASSIGNED/IN_PROGRESS) row already exists for this order+PACK it is
            // completed in-place; otherwise a new DONE row is inserted to record who packed it.
            await pool.query(`
                INSERT INTO work_assignments
                    (entity_type, entity_id, work_type, assigned_packer_id, status, priority, notes, completed_at)
                VALUES ('ORDER', $1, 'PACK', $2, 'DONE', 100, 'Auto-completed on pack scan', NOW())
                ON CONFLICT (entity_type, entity_id, work_type)
                    WHERE status IN ('ASSIGNED', 'IN_PROGRESS')
                DO UPDATE
                    SET assigned_packer_id = EXCLUDED.assigned_packer_id,
                        status             = 'DONE',
                        completed_at       = NOW(),
                        updated_at         = NOW()
            `, [order.id, staffId]);

            const foundInsert = await pool.query(`
                INSERT INTO packer_logs (
                    shipping_tracking_number,
                    tracking_type,
                    pack_date_time,
                    packed_by,
                    packer_photos_url
                ) VALUES ($1, $2, $3, $4, $5::jsonb)
                RETURNING id, pack_date_time::text
            `, [order.shipping_tracking_number, classification.trackingType, packDateTime, staffId, photosJsonb]);

            const foundRecord = {
                id: foundInsert.rows[0]?.id ?? null,
                pack_date_time: foundInsert.rows[0]?.pack_date_time ?? packDateTime,
                shipping_tracking_number: order.shipping_tracking_number,
                packed_by: staffId,
                order_id: order.order_id ?? null,
                product_title: order.product_title ?? null,
                condition: order.condition ?? null,
                quantity: order.quantity ?? null,
                sku: order.sku ?? null,
                packer_photos_url: [],
            };

            await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
            if (foundRecord.id) await prependToPackerLogsCache(staffId, foundRecord);

            return NextResponse.json({
                success: true,
                trackingType: classification.trackingType,
                orderId: order.order_id,
                productTitle: order.product_title,
                condition: order.condition,
                shippingTrackingNumber: order.shipping_tracking_number,
                packedBy: staffId,
                packDateTime,
                packerRecord: foundRecord,
                photosCount: Array.isArray(photos) ? photos.length : 0,
                message: 'Order packed successfully',
            });
        }

        // Non-order scans: write only to packer_logs
        const nonOrderInsert = await pool.query(`
            INSERT INTO packer_logs (
                shipping_tracking_number,
                tracking_type,
                pack_date_time,
                packed_by,
                packer_photos_url
            ) VALUES ($1, $2, $3, $4, $5::jsonb)
            RETURNING id, pack_date_time::text
        `, [classification.normalizedInput, classification.trackingType, packDateTime, staffId, photosJsonb]);
        const nonOrderRecord = {
            id: nonOrderInsert.rows[0]?.id ?? null,
            pack_date_time: nonOrderInsert.rows[0]?.pack_date_time ?? packDateTime,
            shipping_tracking_number: classification.normalizedInput,
            packed_by: staffId,
            order_id: null,
            product_title: null,
            condition: null,
            quantity: null,
            sku: null,
            packer_photos_url: [],
        };

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

        await invalidateCacheTags(['packing-logs', 'orders', 'shipped']);
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

function parseScanTimestamp(input: any): Date | null {
    if (!input) return null;
    const raw = String(input).trim();
    if (!raw) return null;
    if (raw.includes('/')) {
        const cleaned = raw.replace(',', '');
        const [datePart, timePart] = cleaned.split(' ');
        if (!datePart || !timePart) return null;
        const [m, d, y] = datePart.split('/').map(Number);
        const [h, min, s] = timePart.split(':').map(Number);
        if (!m || !d || !y) return null;
        return new Date(y, m - 1, d, h || 0, min || 0, s || 0);
    }
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
}
