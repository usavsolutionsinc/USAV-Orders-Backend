import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        // Map techId to tech name
        const techNames: { [key: string]: string } = {
            '1': 'Michael',
            '2': 'Thuc',
            '3': 'Sang',
            '4': 'Tech 4'
        };
        const techName = techNames[techId] || 'Michael';

        // Query orders table for this tech's completed orders
        const result = await pool.query(`
            SELECT 
                id, 
                test_date_time as timestamp, 
                product_title as title, 
                shipping_tracking_number as tracking, 
                serial_number as serial, 
                condition, 
                quantity as count
            FROM orders
            WHERE tested_by = $1
              AND test_date_time IS NOT NULL 
              AND test_date_time != ''
            ORDER BY id DESC 
            LIMIT $2 OFFSET $3
        `, [techName, limit, offset]);

        return NextResponse.json(result.rows);
    } catch (error: any) {
        console.error('Error fetching tech logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userName, timestamp, tracking, serial } = body;
        
        // Update orders table ONLY (no tech table insert)
        if (serial && tracking) {
            const last8 = tracking.slice(-8).toLowerCase();
            await pool.query(`
                UPDATE orders
                SET serial_number = $1,
                    tested_by = $2,
                    test_date_time = $3
                WHERE RIGHT(shipping_tracking_number, 8) = $4
            `, [serial, userName, timestamp, last8]);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error creating tech log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}
