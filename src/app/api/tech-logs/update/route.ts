import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        const { techId, userName, timestamp, title, tracking, serial } = body;

        const tableName = `tech_${techId}`;
        const last8 = tracking ? tracking.slice(-8).toLowerCase() : '';
        
        // Update the most recent row for this tracking number with serial number and title
        await db.execute(sql.raw(`
            UPDATE ${tableName}
            SET serial_number = '${serial}',
                product_title = '${title}',
                date_time = '${timestamp}'
            WHERE shipping_tracking_number = '${tracking}'
            AND id = (
                SELECT id FROM ${tableName}
                WHERE shipping_tracking_number = '${tracking}'
                ORDER BY id DESC
                LIMIT 1
            )
        `));

        // Update the shipped table if tracking and serial are provided
        if (last8 && serial) {
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

            // Update serial_number, tested_by, status, status_history, and test_date_time
            await db.execute(sql.raw(`
                UPDATE shipped
                SET serial_number = '${serial}',
                    tested_by = '${userName}',
                    status = 'tested',
                    status_history = '${JSON.stringify(statusHistory).replace(/'/g, "''")}',
                    test_date_time = '${now}'
                WHERE RIGHT(shipping_tracking_number, 8) = '${last8}'
            `));
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error updating tech log:', error);
        return NextResponse.json({ error: 'Failed to update log', details: error.message }, { status: 500 });
    }
}
