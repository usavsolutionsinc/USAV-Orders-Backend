import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

export async function POST(request: Request) {
    const { input, techId } = await request.json();
    const client = await pool.connect();

    try {
        const value = input.trim();
        if (!value) return NextResponse.json({ success: false, message: 'Empty input' }, { status: 400 });

        // 1. Checklist Logic (Yes, Used, New, Parts)
        const lowerVal = value.toLowerCase();
        if (['yes', 'used', 'new', 'parts'].includes(lowerVal)) {
            // This requires context of *which* order is being worked on.
            // In GAS, it relied on the "current row". In a web app, we need state.
            // For now, we'll assume the frontend sends the `currentOrderId` if available, 
            // OR we assume this scan applies to the last scanned tracking number for this tech.

            // Let's find the last scanned tracking number for this tech
            const lastLog = await client.query(
                `SELECT tracking_number FROM technician_logs 
                 WHERE tech_id = $1 AND action = 'TRACKING_SCAN' 
                 ORDER BY timestamp DESC LIMIT 1`,
                [techId]
            );

            if (lastLog.rows.length === 0) {
                return NextResponse.json({ success: false, message: 'No active order found. Scan tracking # first.' });
            }

            const tracking = lastLog.rows[0].tracking_number;
            const status = value.charAt(0).toUpperCase() + value.slice(1);

            // Update Order Status
            await client.query(
                `UPDATE orders SET status = $1 WHERE tracking_number = $2`,
                [status, tracking]
            );

            // Move to Shipped (if status implies completion, e.g. New/Used)
            // GAS logic: "Transfer to Shipped sheet"
            if (['Used', 'New', 'Parts'].includes(status)) {
                // Check if already in shipped
                const shippedCheck = await client.query(`SELECT id FROM shipped WHERE tracking_number = $1`, [tracking]);
                if (shippedCheck.rows.length === 0) {
                    // Insert into shipped
                    // We need order_id. 
                    const orderRes = await client.query(`SELECT id FROM orders WHERE tracking_number = $1`, [tracking]);
                    if (orderRes.rows.length > 0) {
                        const orderId = orderRes.rows[0].id;
                        await client.query(
                            `INSERT INTO shipped (id, order_id, carrier, tracking_number, tech_name, status) 
                              VALUES ($1, $2, $3, $4, $5, $6)`,
                            [`SH-${Date.now()}`, orderId, 'Unknown', tracking, `Tech_${techId}`, status]
                        );
                    }
                }
            }

            return NextResponse.json({ success: true, type: 'STATUS_UPDATE', message: `Status updated to ${status}` });
        }

        // 2. Tracking Scan Logic
        // Check if it's a tracking number (simple length check or regex)
        if (value.length > 8) { // Simple heuristic
            // Log it
            await client.query(
                `INSERT INTO technician_logs (tech_id, tracking_number, action, details) VALUES ($1, $2, $3, $4)`,
                [techId, value, 'TRACKING_SCAN', 'Scanned Tracking']
            );

            // Fetch Order Details
            const orderRes = await client.query(
                `SELECT * FROM orders WHERE tracking_number = $1`,
                [value]
            );

            if (orderRes.rows.length > 0) {
                return NextResponse.json({
                    success: true,
                    type: 'TRACKING_SCAN',
                    order: orderRes.rows[0],
                    message: 'Order loaded'
                });
            }
        }

        // 3. SKU Decrement Logic (if it matches SKU pattern)
        // GAS: "Decrement Sku-Stock QTY"
        // Regex: 12345 or 12345x2
        // 3. SKU Decrement Logic (if it matches SKU pattern)
        // GAS: "Decrement Sku-Stock QTY"
        // Regex: 12345 or 12345x2
        if (value.match(/^\d+$/) || value.match(/^\d+x\d+$/i)) {
            let sku = value;
            let qty = 1;
            if (value.includes('x')) {
                const parts = value.toLowerCase().split('x');
                sku = parts[0];
                qty = parseInt(parts[1]) || 1;
            }

            await client.query(
                `UPDATE sku_stock SET quantity = GREATEST(0, quantity - $1) WHERE sku = $2`,
                [qty, sku]
            );

            // GAS Logic: "Retrieve serial numbers from Sku sheet"
            // We look up the SKU in the `skus` table and return any serial numbers found
            const skuRes = await client.query(
                `SELECT serial_numbers FROM skus WHERE sku = $1`,
                [sku]
            );

            let serials = '';
            if (skuRes.rows.length > 0) {
                serials = skuRes.rows[0].serial_numbers;
            }

            // Get Daily Count for this Tech
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const countRes = await client.query(
                `SELECT COUNT(*) FROM technician_logs 
                 WHERE tech_id = $1 AND timestamp >= $2`,
                [techId, todayStart.toISOString()]
            );
            const dailyCount = parseInt(countRes.rows[0].count);

            return NextResponse.json({
                success: true,
                type: 'SKU_DECREMENT',
                message: `Decremented ${qty} from ${sku}`,
                serials,
                dailyCount
            });
        }

        return NextResponse.json({ success: false, message: 'Unknown Input' });

    } catch (error) {
        console.error('Tech Scan Error:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
