import { NextRequest, NextResponse } from 'next/server';
import { db, client } from '@/lib/drizzle/db';
import { packingLogs } from '@/lib/drizzle/schema';
import { desc, eq, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId') || '1';

    try {
        // 1. Try to fetch from the new packing_logs table
        let logs: any[] = [];
        try {
            logs = await db.select()
                .from(packingLogs)
                .where(eq(packingLogs.packerId, parseInt(packerId)))
                .orderBy(desc(packingLogs.packedAt))
                .limit(50);
        } catch (e) {
            console.warn('packing_logs table might not exist yet, skipping new logs');
        }

        // 2. Fetch legacy logs from the packer_X tables
        let legacyLogs: any[] = [];
    try {
        const tableName = `packer_${packerId}`;
        // Verify if table exists by querying information_schema
        const tableCheck = await db.execute(sql.raw(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = '${tableName}'
            );
        `));

        if (tableCheck[0] && tableCheck[0].exists) {
            const legacyData = await db.execute(sql.raw(`
                SELECT col_1 as id, col_2 as "packedAt", col_4 as "trackingNumber", col_3 as product 
                FROM ${tableName} 
                WHERE col_4 IS NOT NULL AND col_4 != ''
                ORDER BY col_1 DESC 
                LIMIT 50
            `));
            
            legacyLogs = legacyData.map((row: any) => ({
                id: `legacy-${row.id}`,
                trackingNumber: row.trackingNumber || 'No Tracking',
                packedAt: row.packedAt || new Date().toISOString(),
                photos: '[]',
                status: 'completed',
                notes: row.product || 'Legacy Order'
            }));
        }
    } catch (e) {
        console.error(`Error fetching legacy logs from packer_${packerId}:`, e);
    }

        // Combine and sort by date
        const combined = [...logs, ...legacyLogs].sort((a, b) => 
            new Date(b.packedAt).getTime() - new Date(a.packedAt).getTime()
        ).slice(0, 50);

        return NextResponse.json(combined);
    } catch (error: any) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch logs', 
            details: error.message 
        }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, photos, packerId, boxSize, notes } = body;

        // Try to insert into packing_logs, if table doesn't exist, we might need to handle it
        // For now we assume it exists if we want to support new photo feature
        const newLog = await db.insert(packingLogs).values({
            trackingNumber,
            photos: JSON.stringify(photos),
            packerId: packerId ? parseInt(packerId) : null,
            boxSize,
            notes,
            status: 'completed'
        }).returning();

        return NextResponse.json(newLog[0]);
    } catch (error: any) {
        console.error('Error creating packing log:', error);
        // If the table doesn't exist, we could fallback or return error
        return NextResponse.json({ 
            error: 'Failed to create log', 
            details: error.message 
        }, { status: 500 });
    }
}
