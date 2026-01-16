import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { receiving } from '@/lib/drizzle/schema';
import { desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        // Query receiving table, ordered by most recent first
        const logs = await db
            .select()
            .from(receiving)
            .orderBy(desc(receiving.col1))
            .limit(limit)
            .offset(offset);

        // Map to StationHistory interface format
        const formattedLogs = logs.map(log => ({
            id: String(log.col1),
            timestamp: log.col2 || '',       // Date/Time
            tracking: log.col3 || '',        // Tracking Number
            status: log.col4 || '',          // Carrier
            count: 0,                        // Will be calculated on client side
        }));

        return NextResponse.json(formattedLogs);
    } catch (error: any) {
        console.error('Error fetching receiving logs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch receiving logs', details: error.message },
            { status: 500 }
        );
    }
}
