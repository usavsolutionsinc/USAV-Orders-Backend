import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { toISOStringPST } from '@/lib/timezone';
import { normalizeTrackingLast8 } from '@/lib/tracking-format';

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

        // Match by last 8 digits (digits-only)
        const scannedTracking = String(tracking || '').trim();
        const last8 = normalizeTrackingLast8(scannedTracking);
        if (!last8 || last8.length < 8) {
            return NextResponse.json({
                success: false,
                error: 'Invalid tracking number'
            }, { status: 400 });
        }

        // Get order by normalized last-8. If missing, allow exception-backed flow.
        const orderResult = await pool.query(`
            SELECT
                id,
                shipping_tracking_number,
                account_source
            FROM orders
            WHERE shipping_tracking_number IS NOT NULL
              AND shipping_tracking_number != ''
              AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
            ORDER BY id DESC
            LIMIT 1
        `, [last8]);
        const order = orderResult.rows[0] || null;

        if (!order) {
            const exceptionResult = await pool.query(
                `SELECT id
                 FROM orders_exceptions
                 WHERE status = 'open'
                   AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
                 ORDER BY id DESC
                 LIMIT 1`,
                [last8]
            );
            if (exceptionResult.rows.length === 0) {
                return NextResponse.json({
                    success: false,
                    error: 'Tracking not found in orders or orders_exceptions'
                }, { status: 404 });
            }
        }
        
        // Determine serial type based on pattern
        let serialType = 'SERIAL';
        if (/^X0|^B0/i.test(serial)) {
            serialType = 'FNSKU';
        } else if (order?.account_source === 'fba') {
            serialType = 'FNSKU';
        }

        // Resolve staff primarily by numeric staff.id (current flow), with legacy employee_id fallback.
        const techIdNum = parseInt(String(techId), 10);
        let staffResult = { rows: [] as Array<{ id: number; name: string }> };
        if (!Number.isNaN(techIdNum) && techIdNum > 0) {
            const byId = await pool.query(
                'SELECT id, name FROM staff WHERE id = $1 LIMIT 1',
                [techIdNum]
            );
            if (byId.rows.length > 0) {
                staffResult = byId;
            }
        }

        if (staffResult.rows.length === 0) {
            const techEmployeeIds: { [key: string]: string } = {
                '1': 'TECH001',
                '2': 'TECH002',
                '3': 'TECH003',
                '4': 'TECH004'
            };
            const employeeId = techEmployeeIds[String(techId)] || String(techId);
            const byEmployeeId = await pool.query(
                'SELECT id, name FROM staff WHERE employee_id = $1 LIMIT 1',
                [employeeId]
            );
            staffResult = byEmployeeId;
        }

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ 
                success: false,
                error: 'Staff not found' 
            }, { status: 404 });
        }

        const staffId = staffResult.rows[0].id;
        const staffName = staffResult.rows[0].name;

        const upperSerial = serial.toUpperCase();
        const parseSerials = (value: string | null | undefined) =>
            String(value || '')
                .split(',')
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);

        // One-row-per-tracking model: append serial to existing row by tracking last-8.
        const existingExactRowResult = await pool.query(
            `SELECT id, shipping_tracking_number, serial_number
             FROM tech_serial_numbers
             WHERE shipping_tracking_number = $1
             ORDER BY id ASC
             LIMIT 1`,
            [scannedTracking]
        );
        const existingRowResult = existingExactRowResult.rows.length > 0
            ? existingExactRowResult
            : await pool.query(
                `SELECT id, shipping_tracking_number, serial_number
                 FROM tech_serial_numbers
                 WHERE RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
                 ORDER BY id ASC
                 LIMIT 1`,
                [last8]
            );

        let updatedSerialList: string[] = [];
        if (existingRowResult.rows.length > 0) {
            const row = existingRowResult.rows[0];
            const existingSerials = parseSerials(row.serial_number);

            if (existingSerials.includes(upperSerial)) {
                return NextResponse.json({ 
                    success: false,
                    error: `Serial ${upperSerial} already scanned for this order`
                });
            }

            updatedSerialList = [...existingSerials, upperSerial];
            await pool.query(
                `UPDATE tech_serial_numbers
                 SET serial_number = $1,
                     test_date_time = date_trunc('second', NOW()),
                     tested_by = $2
                 WHERE id = $3`,
                [updatedSerialList.join(', '), staffId, row.id]
            );
        } else {
            updatedSerialList = [upperSerial];
            await pool.query(
                `INSERT INTO tech_serial_numbers 
                 (shipping_tracking_number, serial_number, serial_type, test_date_time, tested_by)
                 VALUES ($1, $2, $3, date_trunc('second', NOW()), $4)`,
                [scannedTracking, updatedSerialList.join(', '), serialType, staffId]
            );
        }

        // Best-effort status history update. Do not fail serial posting if this metadata write fails.
        if (order?.id) {
            try {
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
            } catch (statusError) {
                console.warn('Status history update failed (serial was still saved):', statusError);
            }
        }

        return NextResponse.json({
            success: true,
            serialNumbers: updatedSerialList,
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
