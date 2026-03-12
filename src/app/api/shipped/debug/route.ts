import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

export async function GET() {
    const client = await pool.connect();
    
    try {
        // Count orders where carrier status = in-transit/delivered (derived shipped)
        const shippedCount = await client.query(`
            SELECT COUNT(DISTINCT o.id) AS count
            FROM orders o
            JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
            WHERE stn.is_carrier_accepted OR stn.is_in_transit
               OR stn.is_out_for_delivery OR stn.is_delivered
        `);

        // Orders with packer logs (FK-based)
        const packedByCount = await client.query(`
            SELECT COUNT(DISTINCT o.id) AS count
            FROM orders o
            INNER JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
            WHERE o.shipment_id IS NOT NULL
              AND pl.tracking_type = 'ORDERS'
        `);

        // Sample shipped orders (derived from stn)
        const sampleShipped = await client.query(`
            SELECT
                o.id,
                o.order_id,
                o.shipment_id,
                stn.tracking_number_raw AS tracking_number,
                stn.latest_status_category AS shipment_status,
                stn.is_delivered,
                pl.packed_by,
                pl.pack_date_time,
                o.product_title
            FROM orders o
            JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
            LEFT JOIN LATERAL (
                SELECT packed_by, created_at AS pack_date_time
                FROM packer_logs
                WHERE shipment_id = o.shipment_id
                  AND tracking_type = 'ORDERS'
                ORDER BY created_at DESC NULLS LAST, id DESC
                LIMIT 1
            ) pl ON true
            WHERE stn.is_carrier_accepted OR stn.is_in_transit
               OR stn.is_out_for_delivery OR stn.is_delivered
            ORDER BY o.id DESC
            LIMIT 10
        `);

        // Orders with packer log but carrier not yet accepted (packed but not yet shipped)
        const packedButNotShipped = await client.query(`
            SELECT COUNT(DISTINCT o.id) AS count
            FROM orders o
            INNER JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
              AND pl.tracking_type = 'ORDERS'
            LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
            WHERE NOT COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
                    OR stn.is_out_for_delivery OR stn.is_delivered, false)
        `);

        return NextResponse.json({
            success: true,
            stats: {
                orders_carrier_shipped: shippedCount.rows[0].count,
                orders_with_packer_log: packedByCount.rows[0].count,
                packed_but_carrier_not_accepted: packedButNotShipped.rows[0].count
            },
            sample_shipped_orders: sampleShipped.rows
        });
        
    } catch (error: any) {
        console.error('Debug error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    } finally {
        client.release();
    }
}
