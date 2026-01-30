import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        const tableName = 'receiving';

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

        // Query receiving table using raw SQL (same pattern as tech-logs)
        const logs = await db.execute(sql.raw(`
            SELECT id, date_time as timestamp, receiving_tracking_number as tracking, carrier as status, quantity as count
            FROM ${tableName} 
            WHERE receiving_tracking_number IS NOT NULL AND receiving_tracking_number != ''
            ORDER BY id DESC 
            LIMIT ${limit} OFFSET ${offset}
        `));

        // Map to StationHistory interface format
        const formattedLogs = logs.map((log: any) => ({
            id: String(log.id),
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            status: log.status || '',         // Carrier
            count: log.count || 0,
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
