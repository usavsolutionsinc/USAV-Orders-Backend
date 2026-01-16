import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

// POST - Add entry to receiving table
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, carrier, timestamp, notes } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        const tableName = 'receiving';
        const now = timestamp || `${new Date().getMonth() + 1}/${new Date().getDate()}/${new Date().getFullYear()} ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}:${String(new Date().getSeconds()).padStart(2, '0')}`;
        
        // Get current count for today
        const countResult = await db.execute(sql.raw(`
            SELECT COALESCE(MAX(col_5), 0) + 1 as next_count
            FROM ${tableName}
            WHERE DATE(TO_TIMESTAMP(col_2, 'MM/DD/YYYY HH24:MI:SS')) = CURRENT_DATE
        `));
        const nextCount = (countResult[0] as any)?.next_count || 1;

        // Insert into receiving table
        // col_2: timestamp, col_3: tracking, col_4: carrier/status, col_5: count
        await db.execute(sql.raw(`
            INSERT INTO ${tableName} (col_2, col_3, col_4, col_5)
            VALUES ('${now}', '${trackingNumber}', '${carrier || 'Unknown'}', ${nextCount})
        `));

        return NextResponse.json({
            success: true,
            message: 'Entry added to receiving table',
            count: nextCount
        }, { status: 201 });
    } catch (error) {
        console.error('Error adding receiving entry:', error);
        return NextResponse.json({ 
            error: 'Failed to add receiving entry',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// GET - Fetch all receiving entries
export async function GET() {
    try {
        const tableName = 'receiving';
        
        const results = await db.execute(sql.raw(`
            SELECT col_1 as id, col_2 as timestamp, col_3 as tracking, col_4 as carrier, col_5 as count
            FROM ${tableName}
            ORDER BY col_1 DESC
            LIMIT 100
        `));
            
        return NextResponse.json(results);
    } catch (error) {
        console.error('Error fetching receiving entries:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving entries',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
