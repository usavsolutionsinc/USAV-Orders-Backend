import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

/**
 * POST /api/orders/update-photos
 * Update packer_photos_url and packing status for an order
 * This runs AFTER all photos have been uploaded to Vercel Blob
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { orderId, trackingNumber, photos, packerId } = body;
        
        console.log('=== UPDATE PHOTOS REQUEST ===');
        console.log('Order ID:', orderId);
        console.log('Tracking:', trackingNumber);
        console.log('Photos count:', photos?.length);
        console.log('Packer ID:', packerId);
        
        // Validate required fields
        if (!orderId && !trackingNumber) {
            return NextResponse.json({ 
                error: 'Either orderId or trackingNumber is required' 
            }, { status: 400 });
        }
        
        if (!photos || !Array.isArray(photos) || photos.length === 0) {
            return NextResponse.json({ 
                error: 'Photos array is required and must not be empty' 
            }, { status: 400 });
        }
        
        // Map packer ID to staff ID
        const packerStaffIds: { [key: string]: number } = {
            '1': 4,  // Tuan
            '2': 5,  // Thuy
        };
        const staffId = packerStaffIds[packerId];
        
        if (!staffId) {
            return NextResponse.json({ 
                error: 'Invalid packer ID' 
            }, { status: 400 });
        }
        
        // Create timestamp
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
        
        // Convert photos to JSONB format
        const photosJsonb = JSON.stringify(photos.map((url, index) => ({
            url,
            index: index + 1,
            uploadedAt: now.toISOString()
        })));
        
        console.log('Photos JSONB:', photosJsonb);
        
        // Try to find order by order_id first, then by tracking number
        let whereClause = 'WHERE order_id = $5';
        let params = [staffId, packDateTime, photosJsonb, 'shipped', orderId];
        
        if (!orderId && trackingNumber) {
            whereClause = 'WHERE shipping_tracking_number = $5';
            params = [staffId, packDateTime, photosJsonb, 'shipped', trackingNumber];
        }
        
        console.log('Update query WHERE:', whereClause);
        console.log('Parameters:', params);
        
        // Update orders table
        const result = await pool.query(`
            UPDATE orders 
            SET packed_by = $1,
                pack_date_time = $2,
                is_shipped = true,
                packer_photos_url = $3::jsonb,
                status = $4
            ${whereClause}
            RETURNING 
                id, 
                order_id, 
                shipping_tracking_number, 
                packer_photos_url,
                packed_by,
                pack_date_time,
                is_shipped,
                status
        `, params);
        
        if (result.rows.length === 0) {
            console.log('ERROR: Order not found!');
            console.log('Tried to match:', orderId || trackingNumber);
            
            // Check if order exists at all
            const checkResult = await pool.query(
                'SELECT order_id, shipping_tracking_number FROM orders WHERE order_id = $1 OR shipping_tracking_number = $2 LIMIT 1',
                [orderId, trackingNumber]
            );
            
            if (checkResult.rows.length === 0) {
                return NextResponse.json({ 
                    error: 'Order not found in database',
                    details: `No order found with ID: ${orderId} or tracking: ${trackingNumber}`
                }, { status: 404 });
            } else {
                return NextResponse.json({ 
                    error: 'Order found but update failed',
                    details: 'Order exists but WHERE clause did not match',
                    foundOrder: checkResult.rows[0]
                }, { status: 500 });
            }
        }
        
        const updatedOrder = result.rows[0];
        
        console.log('=== ORDER UPDATED SUCCESSFULLY ===');
        console.log('Order ID:', updatedOrder.order_id);
        console.log('Tracking:', updatedOrder.shipping_tracking_number);
        console.log('Packed by:', updatedOrder.packed_by);
        console.log('Pack date:', updatedOrder.pack_date_time);
        console.log('Is shipped:', updatedOrder.is_shipped);
        console.log('Status:', updatedOrder.status);
        console.log('Photos saved:', updatedOrder.packer_photos_url);
        
        // Verify photos were saved correctly
        const photoCount = Array.isArray(updatedOrder.packer_photos_url) 
            ? updatedOrder.packer_photos_url.length 
            : 0;
            
        console.log('Photo count in DB:', photoCount);
        
        if (photoCount === 0) {
            console.error('WARNING: Photos array is empty after update!');
        }
        
        return NextResponse.json({
            success: true,
            order: updatedOrder,
            photosCount: photoCount,
            message: `Order updated with ${photoCount} photos`
        });
        
    } catch (error: any) {
        console.error('=== ERROR UPDATING ORDER ===');
        console.error('Error:', error);
        console.error('Message:', error.message);
        console.error('Stack:', error.stack);
        
        return NextResponse.json({ 
            error: 'Failed to update order', 
            details: error.message 
        }, { status: 500 });
    }
}
