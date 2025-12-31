import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    const client = await pool.connect();
    try {
        // Select all col_* columns except id and created_at, plus id for keyField
        const res = await client.query(`
            SELECT id, col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8
            FROM skus 
            ORDER BY col_2 ASC
        `);
        return NextResponse.json(res.rows);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch skus' }, { status: 500 });
    } finally {
        client.release();
    }
}
