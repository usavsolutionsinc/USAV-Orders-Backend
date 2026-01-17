import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');

        if (!query || query.trim() === '') {
            return NextResponse.json({ results: [] });
        }

        const searchTerm = `%${query.trim()}%`;

        // Search through RS table columns:
        // col_3: RS Number (e.g., RS-0001 or Zendesk ticket)
        // col_4: Contact Info (name, phone, email)
        // col_5: Product
        // col_8: Serial Number
        const result = await pool.query(`
            SELECT 
                col_1 as id,
                col_2 as date_time,
                col_3 as rs_number,
                col_4 as contact,
                col_5 as product,
                col_6 as price,
                col_7 as repair_reasons,
                col_8 as serial_number,
                col_9 as parts_needed,
                col_10 as status
            FROM rs
            WHERE 
                col_3 ILIKE $1 OR
                col_4 ILIKE $1 OR
                col_5 ILIKE $1 OR
                col_8 ILIKE $1
            ORDER BY col_1 DESC
            LIMIT 20
        `, [searchTerm]);

        return NextResponse.json({
            results: result.rows,
            count: result.rows.length
        });

    } catch (error: any) {
        console.error('Error searching repairs:', error);
        return NextResponse.json({ 
            error: 'Failed to search repairs',
            details: error.message 
        }, { status: 500 });
    }
}
