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
    if (tracking.startsWith("TBA")) return "AMAZON";
    return "Unknown";
}

export async function POST(request: Request) {
    const { input } = await request.json();
    const client = await pool.connect();

    try {
        const tracking = input.trim();
        if (!tracking) {
            return NextResponse.json({ success: false, message: 'Empty input' }, { status: 400 });
        }

        const carrier = detectCarrier(tracking);
        const timestamp = new Date().toISOString();

        // 1. Log to receiving_logs
        await client.query(
            `INSERT INTO receiving_logs (tracking_number, carrier, timestamp) VALUES ($1, $2, $3)`,
            [tracking, carrier, timestamp]
        );

        // 2. Check for match in orders table
        // We check if the tracking number (or last 8 digits) matches any order
        // The GAS logic used last 8 digits, we'll try exact match first, then last 8 if needed.
        // For simplicity and performance, let's stick to ILIKE or exact match for now, 
        // but the user specifically mentioned "last 8 digits" in GAS.
        // Let's implement a robust check.

        const last8 = tracking.slice(-8);
        const matchRes = await client.query(
            `SELECT id, product_title, status FROM orders WHERE tracking_number ILIKE $1 OR RIGHT(tracking_number, 8) = $2`,
            [`%${tracking}%`, last8]
        );

        const matchFound = matchRes.rows.length > 0;
        const matchDetails = matchFound ? matchRes.rows[0] : null;

        return NextResponse.json({
            success: true,
            carrier,
            matchFound,
            matchDetails,
            message: matchFound ? 'Order Match Found!' : 'Logged successfully'
        });

    } catch (error) {
        console.error('Receiving Scan Error:', error);
        return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}
