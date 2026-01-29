import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { packingLogs, shipped as shippedTable } from '@/lib/drizzle/schema';
import { sql } from 'drizzle-orm';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        const tableName = `packer_${packerId}`;

        // Check if table exists
        const tableCheck = await db.execute(sql.raw(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = '${tableName}'
            );
        `));

        if (!tableCheck[0] || !tableCheck[0].exists) {
            return NextResponse.json([]);
        }

        // Query the packer table using raw SQL
        const logs = await db.execute(sql.raw(`
            SELECT id, date_time as timestamp, shipping_tracking_number as tracking, carrier as status, product_title as title, quantity as count
            FROM ${tableName} 
            WHERE shipping_tracking_number IS NOT NULL AND shipping_tracking_number != ''
            ORDER BY id DESC 
            LIMIT ${limit} OFFSET ${offset}
        `));

        // Map to format expected by StationHistory (include all fields for compatibility)
        const formattedLogs = logs.map((log: any) => ({
            id: `packer${packerId}-${log.id}`,
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            trackingNumber: log.tracking || '',  // For compatibility
            status: log.status || '',
            carrier: log.status || '',            // For compatibility
            title: log.title || '',
            product: log.title || '',             // For compatibility
            count: log.count || 0,
            packedAt: log.timestamp,              // For compatibility
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
        const { trackingNumber, orderId, photos, packerId, boxSize, carrier, timestamp, product } = body;

        const tableName = `packer_${packerId}`;
        
        // Get packer name
        const packerName = `Packer ${packerId}`;
        
        // Insert into the specific packer table
        // date_time, shipping_tracking_number, carrier, product_title, quantity
        await db.execute(sql.raw(`
            INSERT INTO ${tableName} (date_time, shipping_tracking_number, carrier, product_title, quantity)
            VALUES ('${timestamp}', '${trackingNumber}', '${carrier}', '${product}', '${orderId || ''}')
        `));

        // Update shipped table with packer info
        // boxed_by based on tracking number
        await pool.query(`
            UPDATE shipped 
            SET boxed_by = $1
            WHERE shipping_tracking_number = $2
        `, [packerName, trackingNumber]);

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
