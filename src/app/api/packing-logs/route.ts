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

        // Query the packer table using raw SQL (same pattern as tech-logs)
        const logs = await db.execute(sql.raw(`
            SELECT col_1 as id, col_2 as timestamp, col_3 as tracking, col_4 as status, col_5 as title, col_6 as count
            FROM ${tableName} 
            WHERE col_3 IS NOT NULL AND col_3 != ''
            ORDER BY col_1 DESC 
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
        // col_2: timestamp, col_3: tracking, col_4: carrier, col_5: product, col_6: orderId
        await db.execute(sql.raw(`
            INSERT INTO ${tableName} (col_2, col_3, col_4, col_5, col_6)
            VALUES ('${timestamp}', '${trackingNumber}', '${carrier}', '${product}', '${orderId || ''}')
        `));

        // Update shipped table with packer info (matching Working GAS logic)
        // Update col_7 (Box), col_8 (By/Packer name) based on tracking number in col_5
        await pool.query(`
            UPDATE shipped 
            SET col_7 = $1, col_8 = $2
            WHERE col_6 = $3
        `, [boxSize || '', packerName, trackingNumber]);

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
