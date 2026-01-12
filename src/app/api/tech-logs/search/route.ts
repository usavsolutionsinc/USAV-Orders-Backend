import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');

    if (!tracking) {
        return NextResponse.json({ error: 'Tracking number is required' }, { status: 400 });
    }

    try {
        const last8 = tracking.slice(-8).toLowerCase();

        // Search in shipped table (col_5 is tracking)
        // We match by last 8 digits as per GAS logic
        const result = await db.execute(sql.raw(`
            SELECT col_2 as order_id, col_3 as product_name, col_5 as tracking, col_6 as serial, col_8 as tech_name
            FROM shipped
            WHERE RIGHT(col_5, 8) = '${last8}'
            LIMIT 1
        `));

        if (result.length > 0) {
            const row = result[0];
            return NextResponse.json({
                found: true,
                productName: row.product_name,
                orderId: row.order_id,
                sku: '', // We don't have SKU column mapped yet but we could find it if needed
                serial: row.serial,
                techName: row.tech_name
            });
        }

        return NextResponse.json({ found: false });
    } catch (error: any) {
        console.error('Error searching tracking:', error);
        return NextResponse.json({ error: 'Failed to search tracking', details: error.message }, { status: 500 });
    }
}
