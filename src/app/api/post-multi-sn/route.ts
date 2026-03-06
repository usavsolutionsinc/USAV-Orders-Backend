import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/lib/timezone';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sku, serialNumbers, notes, productTitle, location, shippingTrackingNumber } = body;

        if (!sku || !serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
            return NextResponse.json({ error: 'Missing required fields: sku and serialNumbers[]' }, { status: 400 });
        }

        const timestamp = formatPSTTimestamp(new Date());

        const insertResult = await pool.query(
            `INSERT INTO sku
               (date_time, static_sku, serial_number, shipping_tracking_number, notes, location)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
                timestamp,
                sku,
                serialNumbers.join(', '),
                shippingTrackingNumber || null,
                notes || null,
                location || null,
            ]
        );

        return NextResponse.json({
            success: true,
            id: insertResult.rows[0]?.id ?? null,
        });
    } catch (error: any) {
        console.error('[post-multi-sn] DB error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        );
    }
}
