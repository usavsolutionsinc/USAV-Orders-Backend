import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { classifyScan } from '@/utils/packer';
import { normalizeSku } from '@/utils/sku';

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
                return NextResponse.json({
                    error: 'Order not found',
                    details: `No order found with tracking number: ${scanInput}`
                }, { status: 404 });
            }

            const order = orderLookup.rows[0];

            await pool.query(`
                UPDATE orders
                SET packed_by = $1,
                    is_shipped = true,
                    packer_photos_url = $2::jsonb,
                    status = 'shipped'
                WHERE id = $3
            `, [staffId, photosJsonb, order.id]);

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
            const skuRows = await pool.query('SELECT id, stock, sku FROM sku_stock');
            const target = skuRows.rows.find((r: any) => normalizeSku(String(r.sku || '')) === normalizeSku(classification.skuBase || ''));
            if (target) {
                const currentQty = parseInt(target.stock || '0', 10) || 0;
                const addQty = classification.skuQty || 1;
                await pool.query('UPDATE sku_stock SET stock = $1 WHERE id = $2', [String(currentQty + addQty), target.id]);
                skuUpdated = true;
            }
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
