import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders, packerLogs } from '@/lib/drizzle/schema';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const packerId = searchParams.get('packerId');
    const limit = parseInt(searchParams.get('limit') || '5000');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        let query = db
            .select({
                id: packerLogs.id,
                packDateTime: packerLogs.packDateTime,
                shippingTrackingNumber: packerLogs.shippingTrackingNumber,
                trackingType: packerLogs.trackingType,
                packedBy: packerLogs.packedBy,
                packerPhotosUrl: packerLogs.packerPhotosUrl,
                orderId: orders.orderId,
                productTitle: orders.productTitle,
                condition: orders.condition,
                sku: orders.sku,
                statusHistory: orders.statusHistory,
                isShipped: orders.isShipped,
                shipByDate: orders.shipByDate,
                packerId: orders.packerId,
                notes: orders.notes,
                quantity: orders.quantity,
                outOfStock: orders.outOfStock,
                accountSource: orders.accountSource,
                orderDate: orders.orderDate,
            })
            .from(packerLogs)
            .leftJoin(orders, eq(orders.shippingTrackingNumber, packerLogs.shippingTrackingNumber));

        // Filter by packerId if provided
        if (packerId) {
            const packerIdNum = parseInt(packerId);
            if (!isNaN(packerIdNum)) {
                query = query.where(eq(packerLogs.packedBy, packerIdNum)) as any;
            }
        }

        // Order by id descending (most recent first)
        query = query.orderBy(desc(packerLogs.id)) as any;

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
            status: log.trackingType,
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
            trackingType: log.trackingType,
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
        
        const newLog = await db.insert(packerLogs).values({
            packDateTime: body.packDateTime,
            shippingTrackingNumber: body.shippingTrackingNumber,
            trackingType: body.trackingType || 'ORDERS',
            packedBy: body.packedBy,
            packerPhotosUrl: body.packerPhotosUrl || [],
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
            .update(packerLogs)
            .set(updateData)
            .where(eq(packerLogs.id, parseInt(id)))
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
            .delete(packerLogs)
            .where(eq(packerLogs.id, parseInt(id)))
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
