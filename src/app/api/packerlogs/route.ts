import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders } from '@/lib/drizzle/schema';
import { desc, eq, and, isNotNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId');
    const limit = parseInt(searchParams.get('limit') || '5000');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        let query = db.select().from(orders);

        // Filter by packerId if provided
        if (packerId) {
            const packerIdNum = parseInt(packerId);
            if (!isNaN(packerIdNum)) {
                query = query.where(eq(orders.packedBy, packerIdNum)) as any;
            }
        }

        // Filter out entries without pack_date_time
        query = query.where(isNotNull(orders.packDateTime)) as any;

        // Order by id descending (most recent first)
        query = query.orderBy(desc(orders.id)) as any;

        // Apply pagination
        query = query.limit(limit).offset(offset) as any;

        const logs = await query;

        // Format for the component
        const formattedLogs = logs.map((log: any) => ({
            id: log.id.toString(),
            packDateTime: log.packDateTime,
            orderId: log.orderId,
            productTitle: log.productTitle,
            condition: log.condition,
            shippingTrackingNumber: log.shippingTrackingNumber,
            sku: log.sku,
            status: log.status,
            statusHistory: log.statusHistory,
            isShipped: log.isShipped,
            shipByDate: log.shipByDate,
            packerId: log.packerId,
            packedBy: log.packedBy,
            notes: log.notes,
            quantity: log.quantity?.toString() || '1',
            outOfStock: log.outOfStock,
            accountSource: log.accountSource,
            orderDate: log.orderDate,
            // Legacy field mappings for backward compatibility
            timestamp: log.packDateTime,
            tracking: log.shippingTrackingNumber,
            title: log.productTitle,
        }));

        return NextResponse.json(formattedLogs);
    } catch (error: any) {
        console.error('Error fetching packer logs:', error);
        return NextResponse.json({ error: 'Failed to fetch logs', details: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        
        // Create new order entry
        const newLog = await db.insert(orders).values({
            packDateTime: body.packDateTime,
            orderId: body.orderId,
            productTitle: body.productTitle,
            condition: body.condition,
            shippingTrackingNumber: body.shippingTrackingNumber,
            sku: body.sku,
            statusHistory: body.statusHistory || [],
            isShipped: body.isShipped !== undefined ? body.isShipped : false,
            shipByDate: body.shipByDate,
            packerId: body.packerId,
            packedBy: body.packedBy,
            notes: body.notes,
            quantity: body.quantity ? parseInt(body.quantity) : 1,
            outOfStock: body.outOfStock,
            accountSource: body.accountSource,
            orderDate: body.orderDate,
        }).returning();

        return NextResponse.json(newLog[0]);
    } catch (error: any) {
        console.error('Error creating packer log:', error);
        return NextResponse.json({ error: 'Failed to create log', details: error.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const body = await req.json();
        const { id, ...updateData } = body;

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const updatedLog = await db
            .update(orders)
            .set(updateData)
            .where(eq(orders.id, parseInt(id)))
            .returning();

        if (updatedLog.length === 0) {
            return NextResponse.json({ error: 'Log not found' }, { status: 404 });
        }

        return NextResponse.json(updatedLog[0]);
    } catch (error: any) {
        console.error('Error updating packer log:', error);
        return NextResponse.json({ error: 'Failed to update log', details: error.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID is required' }, { status: 400 });
        }

        const deletedLog = await db
            .delete(orders)
            .where(eq(orders.id, parseInt(id)))
            .returning();

        if (deletedLog.length === 0) {
            return NextResponse.json({ error: 'Log not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, deletedLog: deletedLog[0] });
    } catch (error: any) {
        console.error('Error deleting packer log:', error);
        return NextResponse.json({ error: 'Failed to delete log', details: error.message }, { status: 500 });
    }
}
