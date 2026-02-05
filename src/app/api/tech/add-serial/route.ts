import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { toISOStringPST } from '@/lib/timezone';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { tracking, serial, techId } = body;

        if (!tracking || !serial || !techId) {
            return NextResponse.json({ 
                success: false,
                error: 'Tracking, serial, and techId are required' 
            }, { status: 400 });
        }

        // Match by last 8 digits
        const last8 = tracking.slice(-8).toLowerCase();

        // Get the order
        const orderResult = await pool.query(`
            SELECT 
                id,
                shipping_tracking_number,
                account_source
            FROM orders
            WHERE RIGHT(LOWER(shipping_tracking_number), 8) = $1
        `, [last8]);

        if (orderResult.rows.length === 0) {
            return NextResponse.json({ 
                success: false,
                error: 'Order not found' 
            }, { status: 404 });
        }

        const order = orderResult.rows[0];
        
        // Determine serial type based on pattern
        let serialType = 'SERIAL';
        if (/^X0|^B0/i.test(serial)) {
            serialType = 'FNSKU';
        } else if (order.account_source === 'fba') {
            serialType = 'FNSKU';
        }

        // Get staff ID from techId
        const techEmployeeIds: { [key: string]: string } = {
            '1': 'TECH001',
            '2': 'TECH002',
            '3': 'TECH003',
            '4': 'TECH004'
        };
        const employeeId = techEmployeeIds[techId] || 'TECH001';

        const staffResult = await pool.query(
            'SELECT id, name FROM staff WHERE employee_id = $1',
            [employeeId]
        );

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ 
                success: false,
                error: 'Staff not found' 
            }, { status: 404 });
        }

        const staffId = staffResult.rows[0].id;
        const staffName = staffResult.rows[0].name;

        const upperSerial = serial.toUpperCase();

        // Check for duplicate in tech_serial_numbers table
        const duplicateCheck = await pool.query(
            `SELECT id FROM tech_serial_numbers 
             WHERE shipping_tracking_number = $1 AND serial_number = $2`,
            [order.shipping_tracking_number, upperSerial]
        );

        if (duplicateCheck.rows.length > 0) {
            return NextResponse.json({ 
                success: false,
                error: `Serial ${upperSerial} already scanned for this order`
            });
        }

        // Insert into tech_serial_numbers table
        await pool.query(
            `INSERT INTO tech_serial_numbers 
             (shipping_tracking_number, serial_number, serial_type, test_date_time, tester_id)
             VALUES ($1, $2, $3, NOW(), $4)`,
            [order.shipping_tracking_number, upperSerial, serialType, staffId]
        );

        // Update order status_history
        const isoTimestamp = toISOStringPST(new Date().toISOString());

        await pool.query(`
            UPDATE orders
            SET status_history = COALESCE(status_history, '[]'::jsonb) || 
                jsonb_build_object(
                    'status', 'serial_added',
                    'timestamp', $1,
                    'user', $2,
                    'serial', $3,
                    'serial_type', $4,
                    'previous_status', (
                        SELECT COALESCE(
                            (status_history->-1->>'status')::text,
                            null
                        )
                        FROM orders 
                        WHERE id = $5
                    )
                )::jsonb
            WHERE id = $5
        `, [isoTimestamp, staffName, upperSerial, serialType, order.id]);

        // Get updated serial list from tech_serial_numbers
        const updatedSerials = await pool.query(
            `SELECT serial_number FROM tech_serial_numbers 
             WHERE shipping_tracking_number = $1 
             ORDER BY test_date_time ASC`,
            [order.shipping_tracking_number]
        );

        return NextResponse.json({
            success: true,
            serialNumbers: updatedSerials.rows.map((r: any) => r.serial_number),
            serialType,
            isComplete: false
        });
    } catch (error: any) {
        console.error('Error adding serial:', error);
        return NextResponse.json({ 
            success: false,
            error: 'Failed to add serial', 
            details: error.message 
        }, { status: 500 });
    }
}
