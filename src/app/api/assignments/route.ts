import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { parsePositiveInt } from '@/utils/number';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';

const ENTITY_TYPES = new Set(['ORDER', 'REPAIR', 'FBA_SHIPMENT', 'RECEIVING', 'SKU_STOCK']);
const WORK_TYPES = new Set(['TEST', 'PACK', 'REPAIR', 'QA', 'RECEIVE', 'STOCK_REPLENISH']);
const STATUSES = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELED']);

/** Returns the correct assignee column for a given work_type */
function assigneeColumn(workType: string): 'assigned_tech_id' | 'assigned_packer_id' {
  return workType === 'PACK' ? 'assigned_packer_id' : 'assigned_tech_id';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // Accept both new specific params and a generic staff_id fallback
    const assignedTechIdParam = searchParams.get('assigned_tech_id');
    const assignedPackerIdParam = searchParams.get('assigned_packer_id');
    const assignedTechId = assignedTechIdParam ? parsePositiveInt(assignedTechIdParam) : null;
    const assignedPackerId = assignedPackerIdParam ? parsePositiveInt(assignedPackerIdParam) : null;
    const entityType  = String(searchParams.get('entity_type') || '').trim().toUpperCase();
    const workType    = String(searchParams.get('work_type')   || '').trim().toUpperCase();
    const status      = String(searchParams.get('status')      || '').trim().toUpperCase();
    const includeClosed = searchParams.get('include_closed') === 'true';
    const limitRaw    = Number(searchParams.get('limit') || 100);
    const limit       = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

    if (assignedTechIdParam && assignedTechId === null) {
      return NextResponse.json({ success: false, error: 'assigned_tech_id must be a positive integer' }, { status: 400 });
    }
    if (assignedPackerIdParam && assignedPackerId === null) {
      return NextResponse.json({ success: false, error: 'assigned_packer_id must be a positive integer' }, { status: 400 });
    }

    const where: string[] = [];
    const params: any[] = [];

    if (assignedTechId !== null) {
      params.push(assignedTechId);
      where.push(`wa.assigned_tech_id = $${params.length}`);
    }
    if (assignedPackerId !== null) {
      params.push(assignedPackerId);
      where.push(`wa.assigned_packer_id = $${params.length}`);
    }
    if (ENTITY_TYPES.has(entityType)) {
      params.push(entityType);
      where.push(`wa.entity_type = $${params.length}`);
    }
    if (WORK_TYPES.has(workType)) {
      params.push(workType);
      where.push(`wa.work_type = $${params.length}`);
    }
    if (STATUSES.has(status)) {
      params.push(status);
      where.push(`wa.status = $${params.length}`);
    } else if (!includeClosed) {
      where.push(`wa.status IN ('ASSIGNED', 'IN_PROGRESS')`);
    }

    params.push(limit);
    const query = `
      SELECT
        wa.*,
        st.name AS assigned_tech_name,
        sp.name AS assigned_packer_name
      FROM work_assignments wa
      LEFT JOIN staff st ON st.id = wa.assigned_tech_id
      LEFT JOIN staff sp ON sp.id = wa.assigned_packer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY wa.priority ASC, wa.assigned_at ASC
      LIMIT $${params.length}
    `;

    const result = await queryWithRetry(
      () => pool.query(query, params),
      { retries: 3, delayMs: 1000 },
    );
    return NextResponse.json({ success: true, assignments: result.rows });
  } catch (error: any) {
    if (isTransientDbError(error)) {
      console.warn('Assignments DB unavailable (GET):', error?.message || error);
      return NextResponse.json(
        { success: true, assignments: [], fallback: 'db_unavailable' },
        { headers: { 'x-db-fallback': 'unavailable' } }
      );
    }
    console.error('Failed to fetch assignments:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch assignments' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entityType  = String(body?.entity_type || '').trim().toUpperCase();
    const entityId    = parsePositiveInt(body?.entity_id);
    const workType    = String(body?.work_type   || '').trim().toUpperCase();
    const statusRaw   = String(body?.status || 'ASSIGNED').trim().toUpperCase();
    const priorityRaw = Number(body?.priority);
    const notes       = String(body?.notes || '').trim() || null;

    if (!ENTITY_TYPES.has(entityType)) {
      return NextResponse.json({ success: false, error: 'Invalid entity_type' }, { status: 400 });
    }
    if (entityId === null) {
      return NextResponse.json({ success: false, error: 'Valid entity_id is required' }, { status: 400 });
    }
    if (!WORK_TYPES.has(workType)) {
      return NextResponse.json({ success: false, error: 'Invalid work_type' }, { status: 400 });
    }

    // Route the staff id to the appropriate column based on work_type
    const col = assigneeColumn(workType);
    const staffId = parsePositiveInt(body?.assigned_tech_id ?? body?.assigned_packer_id ?? body?.assignee_staff_id);

    const status   = STATUSES.has(statusRaw) ? statusRaw : 'ASSIGNED';
    const priority = Number.isFinite(priorityRaw) ? Math.max(1, Math.min(9999, priorityRaw)) : 100;

    const existing = await pool.query(
      `SELECT id
       FROM work_assignments
       WHERE entity_type = $1
         AND entity_id   = $2
         AND work_type   = $3
         AND status IN ('ASSIGNED', 'IN_PROGRESS')
       ORDER BY id DESC
       LIMIT 1`,
      [entityType, entityId, workType]
    );

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        `UPDATE work_assignments
         SET ${col} = $1,
             status     = $2,
             priority   = $3,
             notes      = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [staffId, status, priority, notes, existing.rows[0].id]
      );
      return NextResponse.json({ success: true, assignment: updated.rows[0] }, { status: 200 });
    }

    const inserted = await pool.query(
      `INSERT INTO work_assignments (
        entity_type, entity_id, work_type, ${col}, status, priority, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [entityType, entityId, workType, staffId, status, priority, notes]
    );

    return NextResponse.json({ success: true, assignment: inserted.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create assignment:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to create assignment' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const id = parsePositiveInt(body?.id);
    if (id === null) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const params: any[]     = [];

    if (body?.assigned_tech_id !== undefined) {
      params.push(parsePositiveInt(body.assigned_tech_id));
      updates.push(`assigned_tech_id = $${params.length}`);
    }
    if (body?.assigned_packer_id !== undefined) {
      params.push(parsePositiveInt(body.assigned_packer_id));
      updates.push(`assigned_packer_id = $${params.length}`);
    }
    if (body?.status !== undefined) {
      const status = String(body.status || '').trim().toUpperCase();
      if (!STATUSES.has(status)) {
        return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
      }
      params.push(status);
      updates.push(`status = $${params.length}`);
      if (status === 'IN_PROGRESS') updates.push(`started_at = COALESCE(started_at, NOW())`);
      if (status === 'DONE' || status === 'CANCELED') updates.push(`completed_at = COALESCE(completed_at, NOW())`);
    }
    if (body?.priority !== undefined) {
      const priorityRaw = Number(body.priority);
      const priority = Number.isFinite(priorityRaw) ? Math.max(1, Math.min(9999, priorityRaw)) : 100;
      params.push(priority);
      updates.push(`priority = $${params.length}`);
    }
    if (body?.notes !== undefined) {
      params.push(String(body.notes || '').trim() || null);
      updates.push(`notes = $${params.length}`);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 });
    }

    updates.push('updated_at = NOW()');
    params.push(id);
    const result = await pool.query(
      `UPDATE work_assignments
       SET ${updates.join(', ')}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Assignment not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, assignment: result.rows[0] });
  } catch (error: any) {
    console.error('Failed to update assignment:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update assignment' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = parsePositiveInt(searchParams.get('id'));
    if (id === null) {
      return NextResponse.json({ success: false, error: 'Valid id is required' }, { status: 400 });
    }

    const result = await pool.query(`DELETE FROM work_assignments WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Assignment not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('Failed to delete assignment:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete assignment' },
      { status: 500 }
    );
  }
}
