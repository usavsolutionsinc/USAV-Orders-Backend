import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingLast8 } from '@/lib/tracking-format';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');
    const techId = searchParams.get('techId');

    if (!tracking) {
        return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 });
    }

    if (!techId) {
        return NextResponse.json({ error: 'Tech ID is required' }, { status: 400 });
    }

    try {
        // Match by last 8 digits of tracking number (digits-only)
        const last8 = normalizeTrackingLast8(tracking).toLowerCase();
        const techIdNum = parseInt(techId, 10);
        if (!techIdNum) {
            return NextResponse.json({ error: 'Invalid Tech ID' }, { status: 400 });
        }

        const staffResult = await pool.query(
            `SELECT id FROM staff WHERE id = $1 LIMIT 1`,
            [techIdNum]
        );
        if (staffResult.rows.length === 0) {
            return NextResponse.json({ error: 'Tech not found in staff table' }, { status: 404 });
        }
        const testedBy = staffResult.rows[0].id;

        // First check tech_serial_numbers for an existing tracking entry
        const existingTracking = await pool.query(
            `SELECT id, shipping_tracking_number 
             FROM tech_serial_numbers 
             WHERE RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $1
             LIMIT 1`,
            [last8]
        );

        if (existingTracking.rows.length > 0) {
            const trackingValue = existingTracking.rows[0].shipping_tracking_number;
            return NextResponse.json({
                found: true,
                orderFound: false,
                order: {
                    id: null,
                    orderId: 'N/A',
                    productTitle: 'Unknown Product',
                    sku: 'N/A',
                    condition: 'N/A',
                    notes: '',
                    tracking: trackingValue,
                    serialNumbers: [],
                    testDateTime: null,
                    testedBy,
                    accountSource: null,
                    quantity: 1,
                    status: null,
                    statusHistory: [],
                    isShipped: false,
                    packerId: null,
                    testerId: null,
                    outOfStock: null,
                    shipByDate: null,
                    orderDate: null,
                    createdAt: null
                }
            });
        }

        // Query orders table by tracking
        const result = await pool.query(`
            SELECT 
                id,
                order_id,
                product_title,
                sku,
                condition,
                notes,
                shipping_tracking_number,
                account_source,
                status,
                status_history,
                is_shipped,
                packer_id,
                tester_id,
                out_of_stock,
                ship_by_date,
                order_date,
                created_at,
                quantity
            FROM orders
            WHERE RIGHT(regexp_replace(shipping_tracking_number, '\\D', '', 'g'), 8) = $1
               OR RIGHT(shipping_tracking_number, 8) = $1
               OR shipping_tracking_number ILIKE '%' || $1
              AND shipping_tracking_number IS NOT NULL
              AND shipping_tracking_number != ''
            LIMIT 1
        `, [last8]);

        if (result.rows.length === 0) {
            return NextResponse.json({ found: false, error: 'Tracking number not found in orders' });
        }

        const row = result.rows[0];
        const trackingValue = row.shipping_tracking_number;

        // Insert into tech_serial_numbers (no serial number yet)
        await pool.query(
            `INSERT INTO tech_serial_numbers (
                shipping_tracking_number, serial_number, tested_by
            ) VALUES ($1, $2, $3)`,
            [trackingValue, null, testedBy]
        );

        return NextResponse.json({
            found: true,
            orderFound: true,
            order: {
                id: row.id,
                orderId: row.order_id || 'N/A',
                productTitle: row.product_title || 'Unknown Product',
                sku: row.sku || 'N/A',
                condition: row.condition || 'N/A',
                notes: row.notes || '',
                tracking: trackingValue,
                serialNumbers: [],
                testDateTime: null,
                testedBy,
                accountSource: row.account_source || null,
                quantity: row.quantity || 1,
                status: row.status || null,
                statusHistory: row.status_history || [],
                isShipped: row.is_shipped || false,
                packerId: row.packer_id || null,
                testerId: row.tester_id || null,
                outOfStock: row.out_of_stock || null,
                shipByDate: row.ship_by_date || null,
                orderDate: row.order_date || null,
                createdAt: row.created_at || null
            }
        });
    } catch (error: any) {
        console.error('Error scanning tracking:', error);
        return NextResponse.json({ 
            error: 'Failed to scan tracking', 
            details: error.message 
        }, { status: 500 });
    }
}
