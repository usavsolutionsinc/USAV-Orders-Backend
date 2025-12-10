import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

function detectCarrier(tracking: string): string {
    if (!tracking) return "Unknown";
    tracking = tracking.trim().toUpperCase();
    if (tracking.startsWith("1Z")) return "UPS";
    if (tracking.startsWith("94") || tracking.startsWith("92") || tracking.startsWith("93") || tracking.startsWith("42")) return "USPS";
    if (tracking.startsWith("96")) return "FedEx";
    if (tracking.startsWith("JD") || tracking.startsWith("JJD")) return "DHL";
    return "Unknown";
}

export async function POST(request: Request) {
    const { input, packerId } = await request.json();
    const client = await pool.connect();

    try {
        const value = input.trim();
        if (!value) return NextResponse.json({ success: false, message: 'Empty input' }, { status: 400 });

        // 1. SKU Logic (Colon check)
        if (value.includes(':')) {
            const [sku, qtyStr] = value.split(':');
            const qty = parseInt(qtyStr) || 0;

            if (sku && qty > 0) {
                // Update sku_stock
                await client.query(
                    `INSERT INTO sku_stock (sku, quantity) VALUES ($1, $2) 
                     ON CONFLICT (sku) DO UPDATE SET quantity = sku_stock.quantity + $2`,
                    [sku.trim(), qty]
                );

                await client.query(
                    `INSERT INTO packer_logs (packer_id, tracking_number, action, details) VALUES ($1, $2, $3, $4)`,
                    [packerId, value, 'SKU_STOCK_ADD', `Added ${qty} to ${sku}`]
                );

                return NextResponse.json({ success: true, type: 'SKU', message: `Added ${qty} to ${sku}` });
            }
        }

        // 2. Carrier/Tracking Logic
        const carrier = detectCarrier(value);
        if (['UPS', 'USPS', 'FedEx'].includes(carrier)) {
            // Duplicate Check (Last Hour)
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const dupCheck = await client.query(
                `SELECT id FROM packer_logs 
                 WHERE tracking_number = $1 AND timestamp > $2`,
                [value, oneHourAgo]
            );

            if (dupCheck.rows.length > 0) {
                return NextResponse.json({ success: false, message: 'Duplicate Scan (Last Hour)' });
            }

            // Log scan
            await client.query(
                `INSERT INTO packer_logs (packer_id, tracking_number, action, details) VALUES ($1, $2, $3, $4)`,
                [packerId, value, 'PACK_SCAN', `Carrier: ${carrier}`]
            );

            // Update Shipped Table (GAS Logic: "Copy from Shipped to Packer" & "Mark Shipped")
            // In our case, we update the Shipped table to indicate it was packed/processed
            // We also fetch the product title to return to the frontend

            // 1. Find in Shipped (or Orders if not in Shipped yet, but GAS implies it checks Shipped)
            // GAS: "Check Shipped sheet... if found... update timestamp/packer name"

            const timestamp = new Date().toISOString();
            const packerName = `Packer_${packerId}`; // Or map ID to name if we had a map

            // Try to update Shipped table
            const updateShipped = await client.query(
                `UPDATE shipped 
                 SET shipped_date = $1, tech_name = COALESCE(tech_name, $2) 
                 WHERE tracking_number = $3
                 RETURNING order_id`,
                [timestamp, packerName, value]
            );

            let productTitle = 'Unknown Product';

            if (updateShipped.rows.length > 0) {
                // It was in Shipped
                const orderId = updateShipped.rows[0].order_id;
                const orderRes = await client.query(`SELECT product_title FROM orders WHERE id = $1`, [orderId]);
                if (orderRes.rows.length > 0) productTitle = orderRes.rows[0].product_title;
            } else {
                // Not in Shipped? Check Orders directly
                const orderRes = await client.query(
                    `SELECT product_title FROM orders WHERE tracking_number = $1`,
                    [value]
                );
                if (orderRes.rows.length > 0) {
                    productTitle = orderRes.rows[0].product_title;
                    // Maybe insert into Shipped? GAS logic was complex here ("Tech to Shipped").
                    // For now, we'll assume if it's not in Shipped, it might be a direct pack.
                }
            }

            // Get Daily Count for this Packer
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const countRes = await client.query(
                `SELECT COUNT(*) FROM packer_logs 
                 WHERE packer_id = $1 AND timestamp >= $2`,
                [packerId, todayStart.toISOString()]
            );
            const dailyCount = parseInt(countRes.rows[0].count);

            return NextResponse.json({
                success: true,
                type: 'TRACKING',
                carrier,
                productTitle,
                dailyCount,
                message: 'Logged & Updated'
            });
        }

        // 3. SKU Pattern Logic (e.g. 12345-A or 12345x2)
        // Simple regex check for SKU-like inputs
        if (value.match(/^\d+-[A-Z]$/i) || value.match(/^\d+x\d+$/i)) {
            await client.query(
                `INSERT INTO packer_logs (packer_id, tracking_number, action, details) VALUES ($1, $2, $3, $4)`,
                [packerId, value, 'SKU_SCAN', 'Logged as SKU']
            );
            return NextResponse.json({ success: true, type: 'SKU_SCAN', message: 'Logged SKU' });
        }

        return NextResponse.json({ success: true, type: 'UNKNOWN', message: 'Logged as Unknown' });

    } catch (error) {
        console.error('Packer Scan Error:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
