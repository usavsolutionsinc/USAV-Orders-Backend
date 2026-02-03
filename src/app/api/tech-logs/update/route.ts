import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        const { userName, timestamp, tracking, serial } = body;
        
        // Update orders table ONLY (no tech table)
        if (tracking && serial) {
            const last8 = tracking.slice(-8).toLowerCase();
            await pool.query(`
                UPDATE orders
                SET serial_number = $1,
                    tested_by = $2,
                    test_date_time = $3
                WHERE RIGHT(shipping_tracking_number, 8) = $4
            `, [serial, userName, timestamp, last8]);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error updating tech log:', error);
        return NextResponse.json({ error: 'Failed to update log', details: error.message }, { status: 500 });
    }
}
