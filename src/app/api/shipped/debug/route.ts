import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

export async function GET() {
    const client = await pool.connect();
    
    try {
        // Check how many orders have is_shipped = true
        const shippedCount = await client.query(`
            SELECT COUNT(*) as count FROM orders WHERE is_shipped = true
        `);
        
        // Check how many orders have packer logs
        const packedByCount = await client.query(`
            SELECT COUNT(DISTINCT o.id) as count
            FROM orders o
            INNER JOIN packer_logs pl
              ON o.shipping_tracking_number = pl.shipping_tracking_number
             AND pl.tracking_type = 'ORDERS'
        `);
        
        // Get sample shipped orders
        const sampleShipped = await client.query(`
            SELECT 
                o.id,
                o.order_id,
                o.shipping_tracking_number,
                o.is_shipped,
                pl.packed_by,
                pl.pack_date_time,
                o.product_title
            FROM orders o
            LEFT JOIN LATERAL (
                SELECT packed_by, pack_date_time
                FROM packer_logs
                WHERE shipping_tracking_number = o.shipping_tracking_number
                  AND tracking_type = 'ORDERS'
                ORDER BY pack_date_time DESC NULLS LAST, id DESC
                LIMIT 1
            ) pl ON true
            WHERE o.is_shipped = true
            ORDER BY o.id DESC
            LIMIT 10
        `);
        
        // Check orders with packed_by but is_shipped = false
        const packedButNotShipped = await client.query(`
            SELECT COUNT(DISTINCT o.id) as count 
            FROM orders o
            INNER JOIN packer_logs pl
              ON o.shipping_tracking_number = pl.shipping_tracking_number
             AND pl.tracking_type = 'ORDERS'
            WHERE (o.is_shipped IS NULL OR o.is_shipped = false)
        `);
        
        return NextResponse.json({
            success: true,
            stats: {
                orders_with_is_shipped_true: shippedCount.rows[0].count,
                orders_with_packed_by: packedByCount.rows[0].count,
                packed_but_not_shipped: packedButNotShipped.rows[0].count
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
