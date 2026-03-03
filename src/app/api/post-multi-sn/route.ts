import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/lib/timezone';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sku, serialNumbers, notes, productTitle, location } = body;

        if (!sku || !serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const timestamp = formatPSTTimestamp(new Date());

        const insertResult = await pool.query(
            `INSERT INTO sku (date_time, static_sku, serial_number, notes, location)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [timestamp, sku, serialNumbers.join(', '), notes || '', location || '']
        );

        return NextResponse.json({
            success: true,
            id: insertResult.rows[0]?.id ?? null,
            note: productTitle ? 'productTitle ignored; title is sourced from sku_stock.product_title' : undefined,
        });
    } catch (error: any) {
        console.error('Post error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
