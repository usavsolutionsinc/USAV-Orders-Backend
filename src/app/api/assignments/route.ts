import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { parsePositiveInt } from '@/utils/number';
import { isTransientDbError } from '@/lib/db-retry';
import {
  getAssignmentsWithStaff,
  getActiveAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  type EntityType,
  type WorkType,
  type AssignmentStatus,
} from '@/lib/neon/assignments-queries';

const ENTITY_TYPES = new Set<EntityType>(['ORDER', 'REPAIR', 'FBA_SHIPMENT', 'RECEIVING', 'SKU_STOCK']);
const WORK_TYPES = new Set<WorkType>(['TEST', 'PACK', 'REPAIR', 'QA', 'RECEIVE', 'STOCK_REPLENISH']);
const STATUSES = new Set<AssignmentStatus>(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELED']);

function parseEnum<T extends string>(value: string | null, allowed: Set<T>): T | null {
  const upper = String(value || '').trim().toUpperCase() as T;
  return allowed.has(upper) ? upper : null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const assignedTechIdParam = searchParams.get('assigned_tech_id');
    const assignedPackerIdParam = searchParams.get('assigned_packer_id');
    const assignedTechId = assignedTechIdParam ? parsePositiveInt(assignedTechIdParam) : undefined;
    const assignedPackerId = assignedPackerIdParam ? parsePositiveInt(assignedPackerIdParam) : undefined;

    if (assignedTechIdParam && assignedTechId == null) {
      throw ApiError.badRequest('assigned_tech_id must be a positive integer');
    }
    if (assignedPackerIdParam && assignedPackerId == null) {
      throw ApiError.badRequest('assigned_packer_id must be a positive integer');
    }

    const entityType = parseEnum(searchParams.get('entity_type'), ENTITY_TYPES);
    const workType = parseEnum(searchParams.get('work_type'), WORK_TYPES);
    const status = parseEnum(searchParams.get('status'), STATUSES);
    const includeClosed = searchParams.get('include_closed') === 'true';
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

    const assignments = await getAssignmentsWithStaff({
      entityType: entityType ?? undefined,
      workType: workType ?? undefined,
      status: status ?? undefined,
      assignedTechId: assignedTechId ?? undefined,
      assignedPackerId: assignedPackerId ?? undefined,
      includeClosed,
      limit,
    });

    return NextResponse.json({ success: true, assignments });
  } catch (error) {
    if (isTransientDbError(error)) {
      return NextResponse.json(
        { success: true, assignments: [], fallback: 'db_unavailable' },
        { headers: { 'x-db-fallback': 'unavailable' } },
      );
    }
    return errorResponse(error, 'GET /api/assignments');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const entityType = parseEnum(body?.entity_type, ENTITY_TYPES);
    const entityId = parsePositiveInt(body?.entity_id);
    const workType = parseEnum(body?.work_type, WORK_TYPES);

    if (!entityType) throw ApiError.badRequest('Invalid entity_type');
    if (entityId === null) throw ApiError.badRequest('Valid entity_id is required');
    if (!workType) throw ApiError.badRequest('Invalid work_type');

    const staffId = parsePositiveInt(body?.assigned_tech_id ?? body?.assigned_packer_id ?? body?.assignee_staff_id);
    const status = parseEnum(body?.status || 'ASSIGNED', STATUSES) ?? 'ASSIGNED';
    const priorityRaw = Number(body?.priority);
    const priority = Number.isFinite(priorityRaw) ? Math.max(1, Math.min(9999, priorityRaw)) : 100;
    const notes = String(body?.notes || '').trim() || null;

    // Check for existing active assignment — update if found
    const existing = await getActiveAssignment(entityType, entityId, workType);

    if (existing) {
      const col = workType === 'PACK' ? 'assignedPackerId' : 'assignedTechId';
      const updated = await updateAssignment(existing.id, {
        [col]: staffId,
        status,
        priority,
        notes,
      });
      return NextResponse.json({ success: true, assignment: updated });
    }

    const assignment = await createAssignment({
      entityType,
      entityId,
      workType,
      ...(workType === 'PACK'
        ? { assignedPackerId: staffId }
        : { assignedTechId: staffId }),
      status,
      notes,
    });

    return NextResponse.json({ success: true, assignment }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'POST /api/assignments');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const id = parsePositiveInt(body?.id);
    if (id === null) throw ApiError.badRequest('Valid id is required');

    const status = body?.status !== undefined ? parseEnum(body.status, STATUSES) : undefined;
    if (body?.status !== undefined && !status) throw ApiError.badRequest('Invalid status');

    const priorityRaw = body?.priority !== undefined ? Number(body.priority) : undefined;
    const priority = priorityRaw !== undefined
      ? (Number.isFinite(priorityRaw) ? Math.max(1, Math.min(9999, priorityRaw)) : 100)
      : undefined;

    const updates: Record<string, any> = {};
    if (status !== undefined) updates.status = status;
    if (body?.assigned_tech_id !== undefined) updates.assignedTechId = parsePositiveInt(body.assigned_tech_id);
    if (body?.assigned_packer_id !== undefined) updates.assignedPackerId = parsePositiveInt(body.assigned_packer_id);
    if (priority !== undefined) updates.priority = priority;
    if (body?.notes !== undefined) updates.notes = String(body.notes || '').trim() || null;

    if (Object.keys(updates).length === 0) {
      throw ApiError.badRequest('No valid fields to update');
    }

    const result = await updateAssignment(id, updates);
    if (!result) throw ApiError.notFound('assignment', id);

    return NextResponse.json({ success: true, assignment: result });
  } catch (error) {
    return errorResponse(error, 'PATCH /api/assignments');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = parsePositiveInt(searchParams.get('id'));
    if (id === null) throw ApiError.badRequest('Valid id is required');

    const deleted = await deleteAssignment(id);
    if (!deleted) throw ApiError.notFound('assignment', id);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/assignments');
  }
}
