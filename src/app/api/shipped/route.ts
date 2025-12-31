import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            // Select all col_* columns except id and created_at, plus id for keyField
            const result = await client.query(`
                SELECT id, col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8, col_9, col_10
                FROM shipped 
                ORDER BY created_at DESC
            `);
            return NextResponse.json(result.rows);
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Database Error:', error);
        return NextResponse.json({ error: 'Failed to fetch shipped items' }, { status: 500 });
    }
}
