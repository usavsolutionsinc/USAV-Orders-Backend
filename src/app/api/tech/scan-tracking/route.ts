import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');
    const techId = searchParams.get('techId');

    if (!tracking) {
        return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 });
    }

    if (!techId) {
        return NextResponse.json({ error: 'Tech ID is required' }, { status: 400 });
    }

    try {
        // Match by last 8 digits of tracking number
        const last8 = tracking.slice(-8).toLowerCase();

        // Query orders table
        const result = await pool.query(`
            SELECT 
                id,
                order_id,
                product_title,
                sku,
                condition,
                notes,
                shipping_tracking_number,
                account_source,
                quantity
            FROM orders
            WHERE RIGHT(LOWER(shipping_tracking_number), 8) = $1
            LIMIT 1
        `, [last8]);

        if (result.rows.length === 0) {
            return NextResponse.json({ found: false });
        }

        const row = result.rows[0];
        
        // Query tech_serial_numbers table for this order's serials and test info
        const serialsResult = await pool.query(`
            SELECT 
                serial_number, 
                serial_type, 
                test_date_time,
                tester_id
            FROM tech_serial_numbers
            WHERE shipping_tracking_number = $1
            ORDER BY test_date_time ASC
        `, [row.shipping_tracking_number]);

        const serialNumbers = serialsResult.rows.map((r: any) => r.serial_number);
        
        // Get first test info (earliest serial scan)
        const firstTest = serialsResult.rows.length > 0 ? serialsResult.rows[0] : null;

        return NextResponse.json({
            found: true,
            order: {
                id: row.id,
                orderId: row.order_id || 'N/A',
                productTitle: row.product_title || 'Unknown Product',
                sku: row.sku || 'N/A',
                condition: row.condition || 'N/A',
                notes: row.notes || '',
                tracking: row.shipping_tracking_number,
                serialNumbers,
                testDateTime: firstTest?.test_date_time,
                testedBy: firstTest?.tester_id,
                accountSource: row.account_source,
                quantity: row.quantity || 1
            }
        });
    } catch (error: any) {
        console.error('Error scanning tracking:', error);
        return NextResponse.json({ 
            error: 'Failed to scan tracking', 
            details: error.message 
        }, { status: 500 });
    }
}
