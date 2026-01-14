import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { packingLogs, shipped as shippedTable } from '@/lib/drizzle/schema';
import { desc, eq, sql } from 'drizzle-orm';
import pool from '@/lib/db';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';

    try {
        const tableName = `packer_${packerId}`;
        const tableCheck = await db.execute(sql.raw(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = '${tableName}'
            );
        `));

        let legacyLogs: any[] = [];
        if (tableCheck[0] && tableCheck[0].exists) {
            const legacyData = await db.execute(sql.raw(`
                SELECT col_1 as id, col_2 as "packedAt", col_3 as "trackingNumber", col_4 as carrier, col_5 as product 
                FROM ${tableName} 
                WHERE col_3 IS NOT NULL AND col_3 != ''
                ORDER BY col_1 DESC 
                LIMIT 50
            `));
            
            legacyLogs = legacyData.map((row: any) => ({
                id: `legacy-${row.id}`,
                trackingNumber: row.trackingNumber,
                packedAt: row.packedAt,
                carrier: row.carrier,
                product: row.product,
                photos: '[]',
                status: 'completed'
            }));
        }

        // Also fetch from the unified packing_logs if any
        let newLogs: any[] = [];
        try {
            newLogs = await db.select().from(packingLogs)
                .where(eq(packingLogs.packerId, parseInt(packerId)))
                .orderBy(desc(packingLogs.packedAt))
                .limit(50);
        } catch (e) {}

        const combined = [...newLogs, ...legacyLogs].sort((a, b) => 
            new Date(b.packedAt || b.timestamp).getTime() - new Date(a.packedAt || a.timestamp).getTime()
        ).slice(0, 50);

        return NextResponse.json(combined);
    } catch (error: any) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, photos, packerId, boxSize, carrier, timestamp, product } = body;

        const tableName = `packer_${packerId}`;
        
        // Get packer name
        const packerName = `Packer ${packerId}`;
        
        // Insert into the specific packer table
        await db.execute(sql.raw(`
            INSERT INTO ${tableName} (col_2, col_3, col_4, col_5)
            VALUES ('${timestamp}', '${trackingNumber}', '${carrier}', '${product}')
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
