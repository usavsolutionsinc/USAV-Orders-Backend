import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all'; // packer, technician, receiving, or all

    const client = await pool.connect();
    try {
        let query = '';
        let params: any[] = [];

        if (type === 'packer') {
            query = 'SELECT * FROM packer_logs ORDER BY timestamp DESC LIMIT 100';
        } else if (type === 'technician') {
            query = 'SELECT * FROM technician_logs ORDER BY timestamp DESC LIMIT 100';
        } else if (type === 'receiving') {
            query = 'SELECT * FROM receiving_logs ORDER BY timestamp DESC LIMIT 100';
        } else {
            // Combine all logs (simplified for now, maybe just fetch separate and combine in frontend or use UNION)
            // Using UNION ALL for simplicity
            query = `
                SELECT 'packer' as source, id, packer_id as user_id, tracking_number, action, details, timestamp FROM packer_logs
                UNION ALL
                SELECT 'technician' as source, id, tech_id as user_id, tracking_number, action, details, timestamp FROM technician_logs
                UNION ALL
                SELECT 'receiving' as source, id, 'receiving' as user_id, tracking_number, 'RECEIVE_SCAN' as action, carrier as details, timestamp FROM receiving_logs
                ORDER BY timestamp DESC LIMIT 200
            `;
        }

        const res = await client.query(query, params);
        return NextResponse.json(res.rows);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
    } finally {
        client.release();
    }
}
