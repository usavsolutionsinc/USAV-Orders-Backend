import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const FEATURE_TYPES = ['feature', 'bug_fix'] as const;
const FEATURE_STATUSES = ['backlog', 'in_progress', 'done'] as const;
const FEATURE_PRIORITIES = ['low', 'medium', 'high'] as const;

type FeatureType = (typeof FEATURE_TYPES)[number];
type FeatureStatus = (typeof FEATURE_STATUSES)[number];
type FeaturePriority = (typeof FEATURE_PRIORITIES)[number];

function isFeatureType(value: string): value is FeatureType {
  return FEATURE_TYPES.includes(value as FeatureType);
}

function isFeatureStatus(value: string): value is FeatureStatus {
  return FEATURE_STATUSES.includes(value as FeatureStatus);
}

function isFeaturePriority(value: string): value is FeaturePriority {
  return FEATURE_PRIORITIES.includes(value as FeaturePriority);
}

function mapRow(row: any) {
  return {
    id: Number(row.id),
    title: String(row.title || ''),
    description: row.description == null ? null : String(row.description),
    type: String(row.type || 'feature') as FeatureType,
    status: String(row.status || 'backlog') as FeatureStatus,
    priority: String(row.priority || 'medium') as FeaturePriority,
    pageArea: row.page_area == null ? null : String(row.page_area),
    sortOrder: Number(row.sort_order || 100),
    isActive: Boolean(row.is_active),
    assignedToStaffId: row.assigned_to_staff_id == null ? null : Number(row.assigned_to_staff_id),
    createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
    updatedByStaffId: row.updated_by_staff_id == null ? null : Number(row.updated_by_staff_id),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid feature id' }, { status: 400 });
    }

    const result = await pool.query('SELECT * FROM admin_features WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
    }

    return NextResponse.json({ feature: mapRow(result.rows[0]) });
  } catch (error: any) {
    console.error('GET /api/admin/features/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin feature', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    const body = await req.json();

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid feature id' }, { status: 400 });
    }

    const updateParts: string[] = [];
    const values: Array<string | number | boolean | null> = [];

    if (body?.title !== undefined) {
      const title = String(body.title || '').trim();
      if (!title) {
        return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
      }
      values.push(title);
      updateParts.push(`title = $${values.length}`);
    }

    if (body?.description !== undefined) {
      values.push(String(body.description || '').trim() || null);
      updateParts.push(`description = $${values.length}`);
    }

    if (body?.type !== undefined) {
      const type = String(body.type || '').trim();
      if (!isFeatureType(type)) {
        return NextResponse.json({ error: 'Invalid feature type' }, { status: 400 });
      }
      values.push(type);
      updateParts.push(`type = $${values.length}`);
    }

    if (body?.status !== undefined) {
      const status = String(body.status || '').trim();
      if (!isFeatureStatus(status)) {
        return NextResponse.json({ error: 'Invalid feature status' }, { status: 400 });
      }
      values.push(status);
      updateParts.push(`status = $${values.length}`);
    }

    if (body?.priority !== undefined) {
      const priority = String(body.priority || '').trim();
      if (!isFeaturePriority(priority)) {
        return NextResponse.json({ error: 'Invalid feature priority' }, { status: 400 });
      }
      values.push(priority);
      updateParts.push(`priority = $${values.length}`);
    }

    if (body?.pageArea !== undefined) {
      values.push(String(body.pageArea || '').trim() || null);
      updateParts.push(`page_area = $${values.length}`);
    }

    if (body?.sortOrder !== undefined) {
      const sortOrder = Number(body.sortOrder);
      if (!Number.isFinite(sortOrder)) {
        return NextResponse.json({ error: 'Invalid sort order' }, { status: 400 });
      }
      values.push(Math.max(0, Math.floor(sortOrder)));
      updateParts.push(`sort_order = $${values.length}`);
    }

    if (body?.isActive !== undefined) {
      values.push(Boolean(body.isActive));
      updateParts.push(`is_active = $${values.length}`);
    }

    if (body?.assignedToStaffId !== undefined) {
      const assignedToStaffId = body.assignedToStaffId == null || body.assignedToStaffId === ''
        ? null
        : Number(body.assignedToStaffId);
      if (assignedToStaffId != null && (!Number.isFinite(assignedToStaffId) || assignedToStaffId <= 0)) {
        return NextResponse.json({ error: 'Invalid assigned staff id' }, { status: 400 });
      }
      values.push(assignedToStaffId);
      updateParts.push(`assigned_to_staff_id = $${values.length}`);
    }

    if (body?.staffId !== undefined) {
      const staffId = body.staffId == null || body.staffId === '' ? null : Number(body.staffId);
      if (staffId != null && (!Number.isFinite(staffId) || staffId <= 0)) {
        return NextResponse.json({ error: 'Invalid updater staff id' }, { status: 400 });
      }
      values.push(staffId);
      updateParts.push(`updated_by_staff_id = $${values.length}`);
    }

    if (updateParts.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    updateParts.push('updated_at = NOW()');
    values.push(id);

    const result = await pool.query(
      `
        UPDATE admin_features
        SET ${updateParts.join(', ')}
        WHERE id = $${values.length}
        RETURNING *
      `,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, feature: mapRow(result.rows[0]) });
  } catch (error: any) {
    console.error('PATCH /api/admin/features/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to update admin feature', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);

    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid feature id' }, { status: 400 });
    }

    const result = await pool.query('DELETE FROM admin_features WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/admin/features/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete admin feature', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
