import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

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

        // Query from tech_serial_numbers and join to orders
        // Sort by most recent test activity (per-serial)
        const result = await pool.query(`
            SELECT 
                o.id,
                MIN(tsn.test_date_time) as timestamp,
                o.product_title as title,
                o.shipping_tracking_number as tracking,
                STRING_AGG(tsn.serial_number, ',' ORDER BY tsn.test_date_time) as serial,
                o.condition,
                o.status_history->-1->>'status' as status,
                COUNT(tsn.serial_number) as serial_count
            FROM tech_serial_numbers tsn
            INNER JOIN orders o ON o.shipping_tracking_number = tsn.shipping_tracking_number
            WHERE tsn.tester_id = $1
            GROUP BY o.id, o.product_title, o.shipping_tracking_number, 
                     o.condition, o.status_history
            ORDER BY MIN(tsn.test_date_time) DESC
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

        return NextResponse.json(result.rows);
    } catch (error: any) {
        console.error('Error fetching tech logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

// POST endpoint removed - replaced by /api/tech/scan-tracking and /api/tech/add-serial
