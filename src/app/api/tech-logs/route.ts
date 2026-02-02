import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const techId = searchParams.get('techId') || '1';

    try {
        const tableName = `tech_${techId}`;
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

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
            SELECT id, date_time as timestamp, product_title as title, shipping_tracking_number as tracking, serial_number as serial, condition, quantity as count
            FROM ${tableName} 
            WHERE shipping_tracking_number IS NOT NULL AND shipping_tracking_number != ''
            ORDER BY id DESC 
            LIMIT ${limit} OFFSET ${offset}
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
        const { techId, userName, timestamp, title, tracking, serial } = body;

        const tableName = `tech_${techId}`;
        
        // 1. Insert into the technician's specific table with tracking only (serial can be empty)
        // quantity column is only touched by sheet import, not manual entries
        const serialValue = serial || '';
        await db.execute(sql.raw(`
            INSERT INTO ${tableName} (date_time, product_title, shipping_tracking_number, serial_number)
            VALUES ('${timestamp}', '${title}', '${tracking}', '${serialValue}')
        `));

        // 2. Only update shipped table if serial number is provided
        if (serial) {
            const last8 = tracking ? tracking.slice(-8).toLowerCase() : '';
            if (last8) {
                // Get current status_history from shipped table
                const currentRecord = await db.execute(sql.raw(`
                    SELECT status_history, status
                    FROM shipped
                    WHERE RIGHT(shipping_tracking_number, 8) = '${last8}'
                    LIMIT 1
                `));

                let statusHistory = [];
                if (currentRecord && currentRecord.length > 0) {
                    const existing = currentRecord[0].status_history;
                    try {
                        statusHistory = typeof existing === 'string' ? JSON.parse(existing) : (existing || []);
                    } catch {
                        statusHistory = [];
                    }
                }

                // Add new history entry
                const now = new Date().toISOString();
                statusHistory.push({
                    status: 'tested',
                    timestamp: now,
                    user: userName,
                    previous_status: currentRecord && currentRecord.length > 0 ? currentRecord[0].status : 'pending'
                });

                // Update serial_number, tested_by, status, status_history, and test_date_time (using tech table timestamp)
                await db.execute(sql.raw(`
                    UPDATE shipped
                    SET serial_number = '${serial}',
                        tested_by = '${userName}',
                        status = 'tested',
                        status_history = '${JSON.stringify(statusHistory).replace(/'/g, "''")}',
                        test_date_time = '${timestamp}'
                    WHERE RIGHT(shipping_tracking_number, 8) = '${last8}'
                `));
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error creating tech log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}
