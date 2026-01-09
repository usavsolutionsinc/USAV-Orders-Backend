import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { packingLogs } from '@/lib/drizzle/schema';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId');

    try {
        let query = db.select().from(packingLogs).orderBy(desc(packingLogs.packedAt));
        
        if (packerId) {
            // @ts-ignore
            query = query.where(eq(packingLogs.packerId, parseInt(packerId)));
        }

        const logs = await query.limit(50);
        return NextResponse.json(logs);
    } catch (error) {
        console.error('Error fetching packing logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { trackingNumber, photos, packerId, boxSize, notes } = body;

        const newLog = await db.insert(packingLogs).values({
            trackingNumber,
            photos: JSON.stringify(photos),
            packerId: packerId ? parseInt(packerId) : null,
            boxSize,
            notes,
            status: 'completed'
        }).returning();

        return NextResponse.json(newLog[0]);
    } catch (error) {
        console.error('Error creating packing log:', error);
        return NextResponse.json({ error: 'Failed to create log' }, { status: 500 });
    }
}
