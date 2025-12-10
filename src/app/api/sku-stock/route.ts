import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

export async function GET() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM sku_stock ORDER BY sku ASC');
        return NextResponse.json(res.rows);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch sku stock' }, { status: 500 });
    } finally {
        client.release();
    }
}
