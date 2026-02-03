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
        
        // Check how many orders have packed_by set
        const packedByCount = await client.query(`
            SELECT COUNT(*) as count FROM orders WHERE packed_by IS NOT NULL
        `);
        
        // Get sample shipped orders
        const sampleShipped = await client.query(`
            SELECT 
                id,
                order_id,
                shipping_tracking_number,
                is_shipped,
                packed_by,
                pack_date_time,
                product_title
            FROM orders 
            WHERE is_shipped = true
            ORDER BY id DESC
            LIMIT 10
        `);
        
        // Check orders with packed_by but is_shipped = false
        const packedButNotShipped = await client.query(`
            SELECT COUNT(*) as count 
            FROM orders 
            WHERE packed_by IS NOT NULL AND (is_shipped IS NULL OR is_shipped = false)
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
