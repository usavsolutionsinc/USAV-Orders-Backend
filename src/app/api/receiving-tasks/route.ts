import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { receivingTasks } from '@/lib/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

// GET - Fetch all receiving tasks
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        let query = db.select().from(receivingTasks);

        const conditions = [];
        if (status) {
            conditions.push(eq(receivingTasks.status, status));
        }

        const results = await db
            .select()
            .from(receivingTasks)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(receivingTasks.createdAt));

        return NextResponse.json(results);
    } catch (error) {
        console.error('Error fetching receiving tasks:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving tasks',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// POST - Create new receiving task
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, orderNumber, notes, staffId } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        const [result] = await db.insert(receivingTasks).values({
            trackingNumber,
            orderNumber: orderNumber || null,
            notes: notes || null,
            staffId: staffId || null,
            status: 'pending',
        }).returning();

        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        console.error('Error creating receiving task:', error);
        return NextResponse.json({ 
            error: 'Failed to create receiving task',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// PUT - Update receiving task
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, status, notes, receivedDate, processedDate, staffId } = body;

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const updateData: any = {};
        if (status !== undefined) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;
        if (receivedDate !== undefined) updateData.receivedDate = receivedDate ? new Date(receivedDate) : null;
        if (processedDate !== undefined) updateData.processedDate = processedDate ? new Date(processedDate) : null;
        if (staffId !== undefined) updateData.staffId = staffId;

        const [result] = await db
            .update(receivingTasks)
            .set(updateData)
            .where(eq(receivingTasks.id, id))
            .returning();

        if (!result) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error updating receiving task:', error);
        return NextResponse.json({ 
            error: 'Failed to update receiving task',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// DELETE - Delete receiving task
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        await db.delete(receivingTasks).where(eq(receivingTasks.id, parseInt(id)));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting receiving task:', error);
        return NextResponse.json({ 
            error: 'Failed to delete receiving task',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
