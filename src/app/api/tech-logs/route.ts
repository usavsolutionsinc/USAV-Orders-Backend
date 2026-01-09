import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId') || '1';

    try {
        const tableName = `tech_${techId}`;
        const tableCheck = await db.execute(sql.raw(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = '${tableName}'
            );
        `));

        if (!tableCheck[0] || !tableCheck[0].exists) {
            return NextResponse.json([]);
        }

        const logs = await db.execute(sql.raw(`
            SELECT col_1 as id, col_2 as timestamp, col_3 as title, col_4 as tracking, col_5 as serial, col_6 as status, col_7 as count
            FROM ${tableName} 
            WHERE col_4 IS NOT NULL AND col_4 != ''
            ORDER BY col_1 DESC 
            LIMIT 100
        `));

        return NextResponse.json(logs);
    } catch (error: any) {
        console.error('Error fetching tech logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { techId, timestamp, title, tracking, serial, count } = body;

        const tableName = `tech_${techId}`;
        
        await db.execute(sql.raw(`
            INSERT INTO ${tableName} (col_2, col_3, col_4, col_5, col_6)
            VALUES ('${timestamp}', '${title}', '${tracking}', '${serial}', '${count}')
        `));

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error creating tech log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}
