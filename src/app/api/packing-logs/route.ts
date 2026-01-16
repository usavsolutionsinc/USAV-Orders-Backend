import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { packingLogs, shipped as shippedTable, packer1, packer2, packer3 } from '@/lib/drizzle/schema';
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        // Select the appropriate packer table based on packerId
        let packerTable;
        if (packerId === '1') packerTable = packer1;
        else if (packerId === '2') packerTable = packer2;
        else if (packerId === '3') packerTable = packer3;
        else packerTable = packer1; // Default to packer1

        // Query the packer table
        const logs = await db
            .select()
            .from(packerTable)
            .where(isNotNull(packerTable.col3)) // Only get rows with tracking numbers
            .orderBy(desc(packerTable.col1))
            .limit(limit)
            .offset(offset);

        // Map to format expected by StationHistory
        const formattedLogs = logs.map(log => ({
            id: `packer${packerId}-${log.col1}`,
            timestamp: log.col2 || '',        // Date/Time (col_2)
            tracking: log.col3 || '',         // Tracking Number (col_3)
            status: log.col4 || '',           // Shipping Carrier (col_4)
            title: log.col5 || '',            // Product Title (col_5)
            count: 0,                         // Will be calculated on client side
            packedAt: log.col2,               // For compatibility
            trackingNumber: log.col3,         // For compatibility
            carrier: log.col4,                // For compatibility
            product: log.col5,                // For compatibility
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
