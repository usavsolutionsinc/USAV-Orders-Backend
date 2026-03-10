import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable } from '@/lib/drizzle/schema';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data } = body;

        if (!data || !Array.isArray(data)) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        const insertedOrders = await db.insert(ordersTable).values(
            data.map((item: any) => ({
                orderId: item.orderNumber || '',
                productTitle: item.itemTitle || '',
                sku: item.usavSku || '',
                condition: item.condition || '',
                shippingTrackingNumber: item.tracking || '',
                notes: item.note || '',
                status: 'unassigned',
                statusHistory: [],
                isShipped: false,
            }))
        ).returning({ id: ordersTable.id });

        for (let i = 0; i < insertedOrders.length; i += 1) {
            const parsedShipByDate = data[i]?.shipByDate ? new Date(data[i].shipByDate) : null;
            const shipByDate = parsedShipByDate && !Number.isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
            if (!shipByDate) continue;

            await pool.query(
                `INSERT INTO work_assignments
                   (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at, notes, assigned_at, created_at, updated_at)
                 VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2, 'Canonical deadline row from import-orders', NOW(), NOW(), NOW())
                 ON CONFLICT DO NOTHING`,
                [insertedOrders[i].id, shipByDate]
            );
        }

        return NextResponse.json({ 
            success: true, 
            message: `Successfully imported ${data.length} orders to DB.` 
        });
    } catch (error: any) {
        console.error('Import error:', error);
        return NextResponse.json({ 
            error: 'Internal Server Error', 
            details: error.message 
        }, { status: 500 });
    }
}
