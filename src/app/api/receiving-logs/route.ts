import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveReceivingSchema } from '@/utils/receiving-schema';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        const tableCheck = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'receiving'
            ) AS exists`
        );
        if (!tableCheck.rows[0]?.exists) {
            return NextResponse.json([]);
        }

        const { dateColumn, hasQuantity } = await resolveReceivingSchema();
        const countExpr = hasQuantity ? "COALESCE(quantity, '1')" : "'1'";

        const logs = await pool.query(`
            SELECT id, ${dateColumn} AS timestamp, receiving_tracking_number AS tracking, carrier AS status, ${countExpr} AS count
            FROM receiving
            WHERE receiving_tracking_number IS NOT NULL AND receiving_tracking_number != ''
            ORDER BY id DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        // Map to StationHistory interface format
        const formattedLogs = logs.rows.map((log: any) => ({
            id: String(log.id),
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            status: log.status || '',         // Carrier
            count: parseInt(String(log.count || '1'), 10) || 1,
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
