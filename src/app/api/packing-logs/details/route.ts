import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tracking = searchParams.get('tracking');

        console.log('=== Order Lookup Request ===');
        console.log('Tracking number received:', tracking);
        console.log('Tracking length:', tracking?.length);

        if (!tracking) {
            return NextResponse.json({ error: 'Tracking number required' }, { status: 400 });
        }

        // Fetch from orders table
        // Query order_id, product_title, condition, shipping_tracking_number
        // Match only last 8 digits, return order regardless of pack status
        // Allows packers to rescan and update orders (retake photos, redo packing)
        const last8 = tracking.slice(-8);
        console.log('Using last 8 digits for matching:', last8);
        console.log('SQL Query: RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)');
        
        const result = await pool.query(`
            SELECT order_id, product_title, condition, shipping_tracking_number as tracking
            FROM orders
            WHERE RIGHT(shipping_tracking_number, 8) = RIGHT($1, 8)
            AND shipping_tracking_number IS NOT NULL 
            AND shipping_tracking_number != ''
            LIMIT 1
        `, [tracking]);

        console.log('Query result rows:', result.rows.length);

        if (result.rows.length === 0) {
            console.log('No order found with matching last 8 digits:', last8);
            return NextResponse.json({ found: false });
        }

        const row = result.rows[0];
        console.log('Order found:', { 
            orderId: row.order_id, 
            dbTracking: row.tracking,
            dbTrackingLength: row.tracking?.length,
            dbLast8: row.tracking?.slice(-8),
            matchedLast8: last8
        });
        
        return NextResponse.json({
            found: true,
            orderId: row.order_id || 'N/A',
            productTitle: row.product_title || 'Unknown Product',
            condition: row.condition || '',
            tracking: row.tracking
        });
    } catch (error: any) {
        console.error('Error fetching order details:', error);
        return NextResponse.json({ error: 'Failed to fetch details', details: error.message }, { status: 500 });
    }
}
