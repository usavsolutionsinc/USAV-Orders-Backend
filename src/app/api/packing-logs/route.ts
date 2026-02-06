import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

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

        // Query orders table for this packer's completed orders using packed_by
        const result = await pool.query(`
            SELECT 
                id, 
                pack_date_time as timestamp, 
                shipping_tracking_number as tracking, 
                product_title as title
            FROM orders
            WHERE packed_by = $1
              AND pack_date_time IS NOT NULL 
              AND pack_date_time != ''
            ORDER BY id DESC 
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
        const { trackingNumber, orderId, photos, packerId, timestamp, product } = body;
        
        console.log('Received packing request:', {
            trackingNumber,
            orderId,
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
        
        // Create proper timestamp - use current server time
        const now = new Date();
        const packDateTime = now.toLocaleString('en-US', { 
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        // Convert photos array to structured JSONB format
        const photosJsonb = Array.isArray(photos) 
            ? JSON.stringify(photos.map((url, index) => ({
                url,
                index: index + 1,
                uploadedAt: now.toISOString()
              })))
            : '[]';
        
        console.log('Updating order with:', {
            staffId,
            packDateTime,
            trackingNumber,
            photosCount: photos?.length,
            status: 'shipped'
        });
        
        // Update orders table with only the required fields
        const result = await pool.query(`
            UPDATE orders 
            SET packed_by = $1,
                pack_date_time = $2,
                is_shipped = true,
                packer_photos_url = $3::jsonb,
                status = 'shipped'
            WHERE shipping_tracking_number = $4
            RETURNING id, order_id, shipping_tracking_number
        `, [staffId, packDateTime, photosJsonb, trackingNumber]);

        if (result.rows.length === 0) {
            return NextResponse.json({ 
                error: 'Order not found',
                details: `No order found with tracking number: ${trackingNumber}`
            }, { status: 404 });
        }

        console.log('Order updated successfully:', result.rows[0]);

        return NextResponse.json({
            success: true,
            order: result.rows[0],
            message: 'Order packed successfully'
        });
    } catch (error: any) {
        console.error('Error updating order:', error);
        return NextResponse.json({ 
            error: 'Failed to update order', 
            details: error.message 
        }, { status: 500 });
    }
}
