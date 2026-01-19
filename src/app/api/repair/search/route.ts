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

        // Search through repair_service table
        const result = await pool.query(`
            SELECT 
                id,
                date_time,
                ticket_number,
                contact,
                product_title,
                price,
                issue as repair_reasons,
                serial_number,
                parts_needed,
                status
            FROM repair_service
            WHERE 
                ticket_number ILIKE $1 OR
                contact ILIKE $1 OR
                product_title ILIKE $1 OR
                serial_number ILIKE $1
            ORDER BY id DESC
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
