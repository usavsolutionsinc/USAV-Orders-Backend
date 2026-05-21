import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { receivingTasks } from '@/lib/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { ApiError, errorResponse } from '@/lib/api';
import { publishReceivingLogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const status = new URL(req.url).searchParams.get('status');

    const results = await db
      .select()
      .from(receivingTasks)
      .where(status ? eq(receivingTasks.status, status) : undefined)
      .orderBy(desc(receivingTasks.createdAt));

    return NextResponse.json(results);
  } catch (error) {
    return errorResponse(error, 'GET /api/receiving-tasks');
  }
}, { permission: 'receiving.view' });

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const { trackingNumber, orderNumber, notes } = body;
    const staffId = ctx.staffId;
    if (!trackingNumber) throw ApiError.badRequest('trackingNumber is required');

    const [result] = await db.insert(receivingTasks).values({
      organizationId: ctx.organizationId,
      trackingNumber,
      orderNumber: orderNumber || null,
      notes: notes || null,
      staffId,
      status: 'pending',
    }).returning();

    await invalidateCacheTags(['receiving-logs']);
    await publishReceivingLogChanged({ action: 'insert', rowId: String(result.id), source: 'receiving-tasks.create' });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-tasks');
  }
}, { permission: 'receiving.mark_received' });

export const PUT = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const { id, status, notes, receivedDate, processedDate } = body;
    if (!id) throw ApiError.badRequest('id is required');
    // Server-trusted actor for status changes (auto-stamp current operator).
    const staffId = ctx.staffId;

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

    if (!result) throw ApiError.notFound('receiving-task', id);

    await invalidateCacheTags(['receiving-logs']);
    await publishReceivingLogChanged({ action: 'update', rowId: String(id), source: 'receiving-tasks.update' });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'PUT /api/receiving-tasks');
  }
}, { permission: 'receiving.mark_received' });

export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw ApiError.badRequest('id is required');

    const [deleted] = await db
      .delete(receivingTasks)
      .where(eq(receivingTasks.id, parseInt(id)))
      .returning({ id: receivingTasks.id });

    if (!deleted) throw ApiError.notFound('receiving-task', id);

    await invalidateCacheTags(['receiving-logs']);
    await publishReceivingLogChanged({ action: 'delete', rowId: String(deleted.id), source: 'receiving-tasks.delete' });

    return NextResponse.json({ success: true, id: deleted.id });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/receiving-tasks');
  }
}, { permission: 'receiving.mark_received' });
