import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { packingLogs } from '@/lib/drizzle/schema';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        // Map packerId directly to staff ID
        // packer_1 (from mobile) -> staff id 4 (Tuan)
        // packer_2 (from mobile) -> staff id 5 (Thuy)
        const packerStaffIds: { [key: string]: number } = {
            '1': 4,  // Tuan
            '2': 5,  // Thuy
            '3': 6   // Future packer (if needed)
        };
        const staffId = packerStaffIds[packerId];

        if (!staffId) {
            return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
        }

        // Query orders table for this packer's completed orders using packed_by
        const result = await pool.query(`
            SELECT 
                id, 
                pack_date_time as timestamp, 
                shipping_tracking_number as tracking, 
                product_title as title
            FROM orders
            WHERE packed_by = $1
              AND pack_date_time IS NOT NULL 
              AND pack_date_time != ''
            ORDER BY id DESC 
            LIMIT $2 OFFSET $3
        `, [staffId, limit, offset]);

        // Map to format expected by StationHistory (include all fields for compatibility)
        const formattedLogs = result.rows.map((log: any) => ({
            id: `packer${packerId}-${log.id}`,
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            trackingNumber: log.tracking || '',
            title: log.title || '',
            product: log.title || '',
            packedAt: log.timestamp,
        }));

        return NextResponse.json(formattedLogs);
    } catch (error: any) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, orderId, photos, packerId, boxSize, timestamp, product } = body;
        
        // Map packerId directly to staff ID
        // packer_1 (from mobile) -> staff id 4 (Tuan)
        // packer_2 (from mobile) -> staff id 5 (Thuy)
        const packerStaffIds: { [key: string]: number } = {
            '1': 4,  // Tuan
            '2': 5,  // Thuy
            '3': 6   // Future packer (if needed)
        };
        const staffId = packerStaffIds[packerId];

        if (!staffId) {
            return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
        }
        
        // Get staff name
        const staffResult = await pool.query(
            'SELECT name FROM staff WHERE id = $1',
            [staffId]
        );

        if (staffResult.rows.length === 0) {
            return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
        }

        const staffName = staffResult.rows[0].name;
        
        // Convert timestamp to ISO format for status_history
        let isoTimestamp = timestamp;
        try {
            if (timestamp && timestamp.includes('/')) {
                const [datePart, timePart] = timestamp.split(' ');
                const [m, d, y] = datePart.split('/');
                isoTimestamp = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`).toISOString();
            }
        } catch (e) {
            // Keep original if conversion fails
        }
        
        // Update orders table ONLY (no packer table insert) - use packed_by instead of boxed_by
        await pool.query(`
            UPDATE orders 
            SET packed_by = $1,
                pack_date_time = $2,
                is_shipped = true,
                status_history = COALESCE(status_history, '[]'::jsonb) || 
                    jsonb_build_object(
                        'status', 'packed',
                        'timestamp', $5,
                        'user', $4,
                        'previous_status', (
                            SELECT COALESCE(
                                (status_history->-1->>'status')::text,
                                null
                            )
                            FROM orders 
                            WHERE shipping_tracking_number = $3
                        )
                    )::jsonb
            WHERE shipping_tracking_number = $3
        `, [staffId, timestamp, trackingNumber, staffName, isoTimestamp]);

        // Record in unified logs for photo support
        const newLog = await db.insert(packingLogs).values({
            trackingNumber,
            orderId: orderId || null,
            photos: JSON.stringify(photos),
            packerId: staffId,
            boxSize,
            notes: product,
            status: 'completed'
        }).returning();

        return NextResponse.json(newLog[0]);
    } catch (error: any) {
        console.error('Error creating packing log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}
