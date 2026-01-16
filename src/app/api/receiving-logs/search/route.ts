import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');

        if (!query) {
            return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
        }

        const tableName = 'receiving';
        const last8 = query.slice(-8);

        // Search in receiving table
        const logs = await db.execute(sql.raw(`
            SELECT col_1 as id, col_2 as timestamp, col_3 as tracking, col_4 as status, col_5 as count
            FROM ${tableName} 
            WHERE 
                (RIGHT(col_3::text, 8) = '${last8}' OR col_3::text ILIKE '%${query}%')
                AND col_3 IS NOT NULL AND col_3 != ''
            ORDER BY col_1 DESC 
            LIMIT 20
        `));

        const formattedLogs = (logs as any[]).map((log: any) => ({
            id: String(log.id),
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            status: log.status || '',
            count: log.count || 0,
        }));

        return NextResponse.json({
            results: formattedLogs,
            count: formattedLogs.length,
            query: query
        });
    } catch (error: any) {
        console.error('Error searching receiving logs:', error);
        return NextResponse.json({ 
            error: 'Failed to search', 
            details: error.message 
        }, { status: 500 });
    }
}
