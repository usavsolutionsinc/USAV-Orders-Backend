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

        // Search across shipping_tracking_number, order_id, serial_number
        // date_time filled = shipped status
        const result = await pool.query(`
            SELECT 
                id,
                date_time,
                order_id,
                product_title,
                condition,
                shipping_tracking_number,
                serial_number,
                boxed_by,
                tested_by,
                sku,
                status,
                CASE 
                    WHEN date_time IS NOT NULL AND date_time != '' THEN true
                    ELSE false
                END as is_shipped
            FROM shipped
            WHERE 
                (RIGHT(shipping_tracking_number::text, 8) = $1 OR shipping_tracking_number::text ILIKE $2)
                OR (RIGHT(order_id::text, 8) = $1 OR order_id::text ILIKE $2)
                OR (RIGHT(serial_number::text, 8) = $1 OR serial_number::text ILIKE $2)
            ORDER BY id DESC
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
