import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/postgres',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

export async function GET() {
    const client = await pool.connect();
    
    try {
        const diagnostics: any = {};
        
        // Check tech_1 records
        const tech1Analysis = await client.query(`
            SELECT 
                COUNT(*) FILTER (WHERE shipping_tracking_number IS NULL OR shipping_tracking_number = '') as null_tracking,
                COUNT(*) FILTER (WHERE shipping_tracking_number LIKE 'X00%') as x00_tracking,
                COUNT(*) FILTER (WHERE date_time IS NULL OR date_time = '') as null_datetime,
                COUNT(*) FILTER (
                    WHERE shipping_tracking_number NOT LIKE 'X00%' 
                    AND shipping_tracking_number IS NOT NULL 
                    AND shipping_tracking_number != ''
                    AND date_time IS NOT NULL 
                    AND date_time != ''
                ) as valid_records,
                COUNT(*) as total_records
            FROM tech_1
        `);
        
        const tech1ValidTracking = await client.query(`
            SELECT t.shipping_tracking_number, t.date_time
            FROM tech_1 t
            LEFT JOIN orders o ON t.shipping_tracking_number = o.shipping_tracking_number
            WHERE t.shipping_tracking_number NOT LIKE 'X00%'
                AND t.shipping_tracking_number IS NOT NULL
                AND t.shipping_tracking_number != ''
                AND t.date_time IS NOT NULL
                AND t.date_time != ''
                AND o.shipping_tracking_number IS NULL
            LIMIT 10
        `);
        
        diagnostics.tech_1 = {
            stats: tech1Analysis.rows[0],
            unmatched_samples: tech1ValidTracking.rows
        };
        
        // Check orders table tracking numbers
        const ordersStats = await client.query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(DISTINCT shipping_tracking_number) as unique_tracking_numbers,
                COUNT(*) FILTER (WHERE shipping_tracking_number IS NULL OR shipping_tracking_number = '') as null_tracking
            FROM orders
        `);
        
        diagnostics.orders = ordersStats.rows[0];
        
        // Check for tracking number matches
        const tech1Matches = await client.query(`
            SELECT COUNT(*) as match_count
            FROM tech_1 t
            INNER JOIN orders o ON t.shipping_tracking_number = o.shipping_tracking_number
            WHERE t.shipping_tracking_number NOT LIKE 'X00%'
                AND t.shipping_tracking_number IS NOT NULL
                AND t.shipping_tracking_number != ''
                AND t.date_time IS NOT NULL
                AND t.date_time != ''
        `);
        
        diagnostics.tech_1.actual_matches = tech1Matches.rows[0].match_count;
        
        // Sample tech_1 records to see the data
        const tech1Samples = await client.query(`
            SELECT shipping_tracking_number, date_time
            FROM tech_1
            WHERE shipping_tracking_number NOT LIKE 'X00%'
                AND shipping_tracking_number IS NOT NULL
                AND shipping_tracking_number != ''
                AND date_time IS NOT NULL
                AND date_time != ''
            LIMIT 20
        `);
        
        diagnostics.tech_1.samples = tech1Samples.rows;
        
        // Sample orders tracking numbers
        const ordersSamples = await client.query(`
            SELECT shipping_tracking_number
            FROM orders
            WHERE shipping_tracking_number IS NOT NULL
                AND shipping_tracking_number != ''
            LIMIT 20
        `);
        
        diagnostics.orders.samples = ordersSamples.rows;
        
        return NextResponse.json({
            success: true,
            diagnostics
        });
        
    } catch (error: any) {
        console.error('Diagnostic error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    } finally {
        client.release();
    }
}
