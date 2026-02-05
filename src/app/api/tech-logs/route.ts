import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { toISOStringPST } from '@/lib/timezone';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        // Map techId to employee_id
        const techEmployeeIds: { [key: string]: string } = {
            '1': 'TECH001',
            '2': 'TECH002',
            '3': 'TECH003',
            '4': 'TECH004'
        };
        const employeeId = techEmployeeIds[techId] || 'TECH001';

        // Get staff ID
        const staffResult = await pool.query(
            'SELECT id FROM staff WHERE employee_id = $1',
            [employeeId]
        );

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        const staffId = staffResult.rows[0].id;

        // Query orders table for this tech's completed orders
        const result = await pool.query(`
            SELECT 
                id, 
                test_date_time as timestamp, 
                product_title as title, 
                shipping_tracking_number as tracking, 
                serial_number as serial, 
                condition,
                status
            FROM orders
            WHERE tested_by = $1
              AND test_date_time IS NOT NULL 
              AND test_date_time != ''
            ORDER BY id DESC 
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

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
        
        // Get staff ID by name
        const staffResult = await pool.query(
            'SELECT id FROM staff WHERE name = $1',
            [userName]
        );

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        const staffId = staffResult.rows[0].id;
        
        // Update orders table ONLY (no tech table insert)
        if (serial && tracking) {
            const last8 = tracking.slice(-8).toLowerCase();
            
            // Convert timestamp to ISO format for status_history (using PST timezone)
            const isoTimestamp = toISOStringPST(timestamp);

            await pool.query(`
                UPDATE orders
                SET serial_number = $1,
                    tested_by = $2,
                    test_date_time = $3,
                    status_history = COALESCE(status_history, '[]'::jsonb) || 
                        jsonb_build_object(
                            'status', 'tested',
                            'timestamp', $6,
                            'user', $5,
                            'previous_status', (
                                SELECT COALESCE(
                                    (status_history->-1->>'status')::text,
                                    null
                                )
                                FROM orders 
                                WHERE RIGHT(shipping_tracking_number, 8) = $4
                            )
                        )::jsonb
                WHERE RIGHT(shipping_tracking_number, 8) = $4
            `, [serial, staffId, timestamp, last8, userName, isoTimestamp]);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error creating tech log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}
