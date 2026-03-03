import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/lib/timezone';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sku, location } = body;

        if (!sku || location === undefined) {
            return NextResponse.json({ error: 'Missing sku or location' }, { status: 400 });
        }

        const timestamp = formatPSTTimestamp(new Date());
        await pool.query(
            `INSERT INTO sku (date_time, static_sku, location, notes)
             VALUES ($1, $2, $3, $4)`,
            [timestamp, sku, location, 'Location updated via Change Location mode']
        );

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Update location error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
