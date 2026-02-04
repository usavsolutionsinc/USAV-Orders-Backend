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
        // Check in orders table
        const ordersResult = await client.query(
            `SELECT id, order_id, shipping_tracking_number, is_shipped, packed_by, pack_date_time, product_title 
             FROM orders 
             WHERE shipping_tracking_number LIKE $1`,
            [`%${tracking}%`]
        );
        
        // Check in packer_1 table
        const packer1Result = await client.query(
            `SELECT shipping_tracking_number, date_time 
             FROM packer_1 
             WHERE shipping_tracking_number LIKE $1`,
            [`%${tracking}%`]
        );
        
        // Check in packer_2 table
        const packer2Result = await client.query(
            `SELECT shipping_tracking_number, date_time 
             FROM packer_2 
             WHERE shipping_tracking_number LIKE $1`,
            [`%${tracking}%`]
        );
        
        return NextResponse.json({
            tracking,
            found_in_orders: ordersResult.rows,
            found_in_packer_1: packer1Result.rows,
            found_in_packer_2: packer2Result.rows,
            summary: {
                in_orders: ordersResult.rows.length > 0,
                in_packer_1: packer1Result.rows.length > 0,
                in_packer_2: packer2Result.rows.length > 0,
                is_shipped: ordersResult.rows[0]?.is_shipped,
                has_packed_by: ordersResult.rows[0]?.packed_by != null
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
