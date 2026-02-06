import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');

        if (!query) {
            return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
        }

        // Support both full query and last 8 digits
        const last8 = query.slice(-8);

        // Search across shipping_tracking_number, order_id, serial_number in orders table
        // Only return orders where is_shipped = true
        const result = await pool.query(`
            SELECT 
                o.id,
                o.ship_by_date,
                o.order_id,
                o.product_title,
                o.condition,
                o.shipping_tracking_number,
                o.packed_by,
                o.tester_id,
                o.sku,
                tsn.test_date_time,
                pl.pack_date_time,
                o.is_shipped
            FROM orders o
            LEFT JOIN LATERAL (
                SELECT pack_date_time
                FROM packer_logs
                WHERE shipping_tracking_number = o.shipping_tracking_number
                  AND tracking_type = 'ORDERS'
                ORDER BY pack_date_time DESC NULLS LAST, id DESC
                LIMIT 1
            ) pl ON true
            LEFT JOIN LATERAL (
                SELECT MIN(test_date_time) as test_date_time
                FROM tech_serial_numbers
                WHERE shipping_tracking_number = o.shipping_tracking_number
            ) tsn ON true
            WHERE o.is_shipped = true
                AND (
                    (RIGHT(o.shipping_tracking_number::text, 8) = $1 OR o.shipping_tracking_number::text ILIKE $2)
                    OR (RIGHT(o.order_id::text, 8) = $1 OR o.order_id::text ILIKE $2)
                )
            ORDER BY o.id DESC
            LIMIT 20
        `, [last8, `%${query}%`]);

        return NextResponse.json({
            results: result.rows,
            count: result.rows.length,
            query: query
        });
    } catch (error: any) {
        console.error('Error searching shipped table:', error);
        return NextResponse.json({ 
            error: 'Failed to search', 
            details: error.message 
        }, { status: 500 });
    }
}

// POST endpoint to save search history
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { query, resultCount } = body;

        // Store in a simple search_history table (you may need to create this)
        // For now, we'll just return success
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error saving search history:', error);
        return NextResponse.json({ 
            error: 'Failed to save search history', 
            details: error.message 
        }, { status: 500 });
    }
}
