import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

// POST - Add entry to receiving table (for Google Sheets sync)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, carrier, date, notes } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        // Insert into receiving table (col_2 = tracking number)
        const result = await pool.query(
            'INSERT INTO receiving (col_2, col_3, col_4, col_5) VALUES ($1, $2, $3, $4) RETURNING *',
            [trackingNumber, carrier || null, date || new Date().toISOString(), notes || null]
        );

        return NextResponse.json({
            success: true,
            entry: result.rows[0],
            message: 'Entry added to receiving table'
        }, { status: 201 });
    } catch (error) {
        console.error('Error adding receiving entry:', error);
        return NextResponse.json({ 
            error: 'Failed to add receiving entry',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// GET - Fetch all receiving entries
export async function GET() {
    try {
        const result = await pool.query('SELECT * FROM receiving ORDER BY col_1 DESC');
        return NextResponse.json(result.rows);
    } catch (error) {
        console.error('Error fetching receiving entries:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving entries',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

