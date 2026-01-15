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

        // Search across col_3 (tracking), col_6 (order ID), col_7 (serial number)
        // col_2 filled = shipped status
        const result = await pool.query(`
            SELECT 
                col_1 as id,
                col_2 as shipped_date,
                col_3 as tracking_number,
                col_4 as customer,
                col_5 as product,
                col_6 as order_id,
                col_7 as serial_number,
                col_8 as notes,
                CASE 
                    WHEN col_2 IS NOT NULL AND col_2 != '' THEN true
                    ELSE false
                END as is_shipped
            FROM shipped
            WHERE 
                (RIGHT(col_3::text, 8) = $1 OR col_3::text ILIKE $2)
                OR (RIGHT(col_6::text, 8) = $1 OR col_6::text ILIKE $2)
                OR (RIGHT(col_7::text, 8) = $1 OR col_7::text ILIKE $2)
            ORDER BY col_1 DESC
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
