import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const tracking = searchParams.get('tracking');
    
    if (!tracking) {
        return NextResponse.json({ error: 'tracking parameter required' }, { status: 400 });
    }

    const client = await pool.connect();
    
    try {
        // Check in orders table with packer_logs join (latest ORDERS scan)
        const ordersResult = await client.query(
            `SELECT o.id, o.order_id, o.shipping_tracking_number, o.is_shipped, 
                    o.packer_id, o.tester_id, o.product_title,
                    pl.packed_by, pl.pack_date_time
             FROM orders o
             LEFT JOIN LATERAL (
                 SELECT packed_by, pack_date_time
                 FROM packer_logs
                 WHERE shipping_tracking_number = o.shipping_tracking_number
                   AND tracking_type = 'ORDERS'
                 ORDER BY pack_date_time DESC NULLS LAST, id DESC
                 LIMIT 1
             ) pl ON true
             WHERE o.shipping_tracking_number LIKE $1`,
            [`%${tracking}%`]
        );
        
        // Check in packer_logs table
        const packerLogsResult = await client.query(
            `SELECT shipping_tracking_number, tracking_type, pack_date_time 
             FROM packer_logs 
             WHERE shipping_tracking_number ILIKE $1
             ORDER BY pack_date_time DESC NULLS LAST
             LIMIT 50`,
            [`%${tracking}%`]
        );
        
        return NextResponse.json({
            tracking,
            found_in_orders: ordersResult.rows,
            found_in_packer_logs: packerLogsResult.rows,
            summary: {
                in_orders: ordersResult.rows.length > 0,
                in_packer_logs: packerLogsResult.rows.length > 0,
                is_shipped: ordersResult.rows[0]?.is_shipped,
                has_packer_id: ordersResult.rows[0]?.packer_id != null,
                packer_id: ordersResult.rows[0]?.packer_id,
                tester_id: ordersResult.rows[0]?.tester_id
            }
        });
        
    } catch (error: any) {
        console.error('Check tracking error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    } finally {
        client.release();
    }
}
