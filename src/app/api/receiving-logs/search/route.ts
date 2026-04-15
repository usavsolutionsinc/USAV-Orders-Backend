import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveReceivingSchema } from '@/utils/receiving-schema';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get('q');

        if (!query) {
            return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
        }

        const last8 = query.slice(-8);
        const { dateColumn, hasQuantity } = await resolveReceivingSchema();
        const countExpr = hasQuantity ? "COALESCE(quantity, '1')" : "'1'";

        // Search across both the canonical shipment tracking (stn.tracking_number_raw)
        // and the legacy receiving_tracking_number text column. The JOIN is a LEFT JOIN
        // so rows without a shipment_id still match via the legacy column.
        const logs = await pool.query(
            `SELECT r.id,
                    r.${dateColumn} AS timestamp,
                    COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) AS tracking,
                    COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier) AS status,
                    ${countExpr} AS count
             FROM receiving r
             LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
             WHERE (
                    RIGHT(COALESCE(stn.tracking_number_raw, r.receiving_tracking_number)::text, 8) = $1
                 OR COALESCE(stn.tracking_number_raw, r.receiving_tracking_number)::text ILIKE $2
               )
               AND COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) IS NOT NULL
               AND COALESCE(stn.tracking_number_raw, r.receiving_tracking_number) <> ''
             ORDER BY r.id DESC`,
            [last8, `%${query}%`]
        );

        const formattedLogs = logs.rows.map((log: any) => ({
            id: String(log.id),
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            status: log.status || '',
            count: parseInt(String(log.count || '1'), 10) || 1,
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
