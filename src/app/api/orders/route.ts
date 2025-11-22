import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500');
            // Transform data if necessary to match UI expectations
            const orders = result.rows.map(row => ({
                id: row.id,
                buyerName: row.buyer_name,
                items: [
                    {
                        title: row.product_title,
                        qty: row.qty,
                        sku: row.sku,
                        skuDocuments: [] // Placeholder if not in DB yet
                    }
                ],
                shipBy: row.ship_by,
                shippingSpeed: row.shipping_speed,
                trackingNumber: row.tracking_number,
                status: row.status
            }));
            return NextResponse.json(orders);
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Database Error:', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}
