import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            // Join with orders to get details
            const result = await client.query(`
        SELECT s.*, o.buyer_name, o.product_title, o.sku 
        FROM shipped s
        JOIN orders o ON s.order_id = o.id
        ORDER BY s.shipped_date DESC 
        LIMIT 500
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
