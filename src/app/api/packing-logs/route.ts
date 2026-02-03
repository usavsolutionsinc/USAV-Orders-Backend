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
        // Map packerId to packer name
        const packerNames: { [key: string]: string } = {
            '1': 'Tuan',
            '2': 'Thuy',
            '3': 'Packer 3'
        };
        const packerName = packerNames[packerId] || 'Tuan';

        // Query orders table for this packer's completed orders
        const result = await pool.query(`
            SELECT 
                id, 
                pack_date_time as timestamp, 
                shipping_tracking_number as tracking, 
                product_title as title, 
                quantity as count
            FROM orders
            WHERE boxed_by = $1
              AND pack_date_time IS NOT NULL 
              AND pack_date_time != ''
            ORDER BY id DESC 
            LIMIT $2 OFFSET $3
        `, [packerName, limit, offset]);

        // Map to format expected by StationHistory (include all fields for compatibility)
        const formattedLogs = result.rows.map((log: any) => ({
            id: `packer${packerId}-${log.id}`,
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            trackingNumber: log.tracking || '',
            title: log.title || '',
            product: log.title || '',
            count: log.count || 0,
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
        
        // Map packerId to packer name
        const packerNames: { [key: string]: string } = {
            '1': 'Tuan',
            '2': 'Thuy',
            '3': 'Packer 3'
        };
        const packerName = packerNames[packerId] || `Packer ${packerId}`;
        
        // Update orders table ONLY (no packer table insert)
        await pool.query(`
            UPDATE orders 
            SET boxed_by = $1,
                pack_date_time = $2,
                is_shipped = true
            WHERE shipping_tracking_number = $3
        `, [packerName, timestamp, trackingNumber]);

        // Record in unified logs for photo support
        const newLog = await db.insert(packingLogs).values({
            trackingNumber,
            orderId: orderId || null,
            photos: JSON.stringify(photos),
            packerId: packerId ? parseInt(packerId) : null,
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
