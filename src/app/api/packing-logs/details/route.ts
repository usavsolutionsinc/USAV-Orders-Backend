import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tracking = searchParams.get('tracking');

        if (!tracking) {
            return NextResponse.json({ error: 'Tracking number required' }, { status: 400 });
        }

        // Fetch from shipped table (col_6 is tracking number)
        // col_3 = Order ID, col_4 = Product Title, col_5 = Condition, col_6 = Tracking
        // Match only last 8 digits, only scan where col_6 is filled and col_2 is empty
        const result = await pool.query(`
            SELECT col_3 as order_id, col_4 as product_title, col_5 as condition, col_6 as tracking
            FROM shipped
            WHERE RIGHT(col_6, 8) = RIGHT($1, 8)
            AND col_6 IS NOT NULL 
            AND col_6 != ''
            AND (col_2 IS NULL OR col_2 = '')
            LIMIT 1
        `, [tracking]);

        if (result.rows.length === 0) {
            return NextResponse.json({ found: false });
        }

        const row = result.rows[0];
        
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
