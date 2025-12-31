import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            // Select all columns except id and created_at, plus id for keyField
            const result = await client.query(`
                SELECT id, col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8, 
                       col_9, col_10, col_11, col_12, col_13, col_14, col_15, col_16
                FROM orders 
                ORDER BY created_at DESC 
                LIMIT 500
            `);
            return NextResponse.json(result.rows);
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Database Error:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}
