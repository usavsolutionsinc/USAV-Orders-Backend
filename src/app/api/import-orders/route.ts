import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable } from '@/lib/drizzle/schema';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data } = body;

        if (!data || !Array.isArray(data)) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        // Prepare data for Neon DB - insert into orders table (from shipped sheet data)
        const ordersToInsert = data.map((item: any) => {
            const parsedShipByDate = item.shipByDate ? new Date(item.shipByDate) : null;
            const shipByDate = parsedShipByDate && !isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
            return {
            orderId: item.orderNumber || '',
            productTitle: item.itemTitle || '',
            sku: item.usavSku || '',
            condition: item.condition || '',
            shippingTrackingNumber: item.tracking || '',
            shipByDate,
            notes: item.note || '',
            status: 'unassigned',
            statusHistory: [],
            isShipped: false, // New orders are not shipped yet
        };
        });

        await db.insert(ordersTable).values(ordersToInsert);

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
