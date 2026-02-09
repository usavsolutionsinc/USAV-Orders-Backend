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

        // Query ALL individual records from tech_serial_numbers
        // Use scalar subqueries to ensure exactly one row per tech_serial_numbers record
        const result = await pool.query(`
            SELECT 
                tsn.id,
                tsn.test_date_time,
                tsn.shipping_tracking_number,
                tsn.serial_number,
                tsn.tested_by,
                (
                    SELECT o.order_id 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(tsn.shipping_tracking_number, 8)
                    LIMIT 1
                ) as order_id,
                (
                    SELECT o.product_title 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(tsn.shipping_tracking_number, 8)
                    LIMIT 1
                ) as product_title,
                (
                    SELECT o.condition 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(tsn.shipping_tracking_number, 8)
                    LIMIT 1
                ) as condition,
                (
                    SELECT o.sku 
                    FROM orders o 
                    WHERE RIGHT(o.shipping_tracking_number, 8) = RIGHT(tsn.shipping_tracking_number, 8)
                    LIMIT 1
                ) as sku
            FROM tech_serial_numbers tsn
            WHERE tsn.tested_by = $1
            ORDER BY tsn.test_date_time DESC NULLS LAST
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

        return NextResponse.json(result.rows);
    } catch (error: any) {
        console.error('Error fetching tech logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

// POST endpoint removed - replaced by /api/tech/scan-tracking and /api/tech/add-serial
