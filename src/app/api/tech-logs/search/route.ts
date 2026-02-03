import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
        return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 });
    }

    try {
        const last8 = tracking.slice(-8).toLowerCase();

        // Search in orders table
        // We match by last 8 digits as per GAS logic
        const result = await pool.query(`
            SELECT 
                order_id, 
                product_title as product_name, 
                shipping_tracking_number as tracking, 
                serial_number as serial, 
                tested_by as tech_name,
                sku,
                condition,
                notes
            FROM orders
            WHERE RIGHT(shipping_tracking_number, 8) = $1
            LIMIT 1
        `, [last8]);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            return NextResponse.json({
                found: true,
                productName: row.product_name,
                orderId: row.order_id,
                sku: row.sku || '',
                serial: row.serial,
                techName: row.tech_name,
                condition: row.condition,
                notes: row.notes
            });
        }

        return NextResponse.json({ found: false });
    } catch (error: any) {
        console.error('Error searching tracking:', error);
        return NextResponse.json({ error: 'Failed to search tracking', details: error.message }, { status: 500 });
    }
}
