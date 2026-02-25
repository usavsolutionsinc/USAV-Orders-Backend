import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { classifyScan } from '@/utils/packer';
import { normalizeSku } from '@/utils/sku';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
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

        return NextResponse.json(formattedLogs);
    } catch (error: any) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, photos, packerId, timestamp } = body;
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
        const staffName = staffNameResult.rows[0]?.name || null;

        if (classification.trackingType === 'ORDERS') {
            const orderLookup = await pool.query(
                `SELECT id, order_id, shipping_tracking_number
                 FROM orders
                 WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)
                 AND shipping_tracking_number IS NOT NULL
                 AND shipping_tracking_number != ''
                 ORDER BY id DESC
                 LIMIT 1`,
                [scanInput]
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

                await pool.query(`
                    INSERT INTO packer_logs (
                        shipping_tracking_number,
                        tracking_type,
                        pack_date_time,
                        packed_by,
                        packer_photos_url
                    ) VALUES ($1, $2, $3, $4, $5::jsonb)
                `, [scanInput, classification.trackingType, packDateTime, staffId, photosJsonb]);

                return NextResponse.json({
                    success: true,
                    warning: 'Order not found in orders. Added to exceptions queue.',
                    trackingType: classification.trackingType,
                    shippingTrackingNumber: scanInput,
                    packedBy: staffId,
                    packDateTime,
                    photosCount: Array.isArray(photos) ? photos.length : 0
                });
            }

            const order = orderLookup.rows[0];

            await pool.query(`
                UPDATE orders
                SET packer_id = $1,
                    is_shipped = true,
                    status = 'shipped'
                WHERE id = $2
                AND is_shipped = false
            `, [staffId, order.id]);

            await pool.query(`
                INSERT INTO packer_logs (
                    shipping_tracking_number,
                    tracking_type,
                    pack_date_time,
                    packed_by,
                    packer_photos_url
                ) VALUES ($1, $2, $3, $4, $5::jsonb)
            `, [order.shipping_tracking_number, classification.trackingType, packDateTime, staffId, photosJsonb]);

            return NextResponse.json({
                success: true,
                trackingType: classification.trackingType,
                orderId: order.order_id,
                shippingTrackingNumber: order.shipping_tracking_number,
                packedBy: staffId,
                packDateTime,
                photosCount: Array.isArray(photos) ? photos.length : 0,
                message: 'Order packed successfully'
            });
        }

        // Non-order scans: write only to packer_logs
        await pool.query(`
            INSERT INTO packer_logs (
                shipping_tracking_number,
                tracking_type,
                pack_date_time,
                packed_by,
                packer_photos_url
            ) VALUES ($1, $2, $3, $4, $5::jsonb)
        `, [classification.normalizedInput, classification.trackingType, packDateTime, staffId, photosJsonb]);

        let skuUpdated = false;
        if (classification.trackingType === 'SKU' && classification.skuBase) {
            const addQty = classification.skuQty || 1;
            const normalizedBase = normalizeSku(classification.skuBase || '');

            const skuRows = await pool.query('SELECT id, stock, sku, product_title FROM sku_stock');
            const target = skuRows.rows.find(
                (r: any) => normalizeSku(String(r.sku || '')) === normalizedBase
            );

            let resolvedTitle: string | null = target?.product_title || null;
            if (!resolvedTitle) {
                const staticCandidates = Array.from(new Set([
                    String(classification.skuStatic || '').trim(),
                    String(scanInput || '').trim(),
                    String(classification.normalizedInput || '').trim(),
                ])).filter(Boolean);

                for (const staticSku of staticCandidates) {
                    const skuTitleResult = await pool.query(
                        `SELECT product_title
                         FROM sku
                         WHERE TRIM(static_sku) = $1
                         ORDER BY id DESC
                         LIMIT 1`,
                        [staticSku]
                    );
                    if (skuTitleResult.rows.length > 0) {
                        resolvedTitle = skuTitleResult.rows[0]?.product_title || null;
                        break;
                    }
                }
            }

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

        return NextResponse.json({
            success: true,
            trackingType: classification.trackingType,
            shippingTrackingNumber: classification.normalizedInput,
            packedBy: staffId,
            packDateTime,
            photosCount: Array.isArray(photos) ? photos.length : 0,
            skuUpdated
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
