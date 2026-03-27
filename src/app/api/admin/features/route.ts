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

function parseBooleanFilter(value: string | null): boolean | null {
  if (value == null || value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
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
    assignedToStaffName: row.assigned_to_staff_name == null ? null : String(row.assigned_to_staff_name),
    createdByStaffId: row.created_by_staff_id == null ? null : Number(row.created_by_staff_id),
    updatedByStaffId: row.updated_by_staff_id == null ? null : Number(row.updated_by_staff_id),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const type = String(searchParams.get('type') || '').trim();
    const status = String(searchParams.get('status') || '').trim();
    const active = parseBooleanFilter(searchParams.get('active'));
    const limitParam = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, Math.floor(limitParam))) : 200;

    const conditions: string[] = [];
    const params: Array<string | number | boolean> = [];

    if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      conditions.push(`(
        af.title ILIKE $${idx}
        OR COALESCE(af.description, '') ILIKE $${idx}
        OR COALESCE(af.page_area, '') ILIKE $${idx}
      )`);
    }

    if (isFeatureType(type)) {
      params.push(type);
      conditions.push(`af.type = $${params.length}`);
    }

    if (isFeatureStatus(status)) {
      params.push(status);
      conditions.push(`af.status = $${params.length}`);
    }

    if (active !== null) {
      params.push(active);
      conditions.push(`af.is_active = $${params.length}`);
    }

    params.push(limit);

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `
        SELECT
          af.*,
          s.name AS assigned_to_staff_name
        FROM admin_features af
        LEFT JOIN staff s
          ON s.id = af.assigned_to_staff_id
        ${whereSql}
        ORDER BY
          af.is_active DESC,
          CASE af.status
            WHEN 'in_progress' THEN 0
            WHEN 'backlog' THEN 1
            ELSE 2
          END,
          CASE af.priority
            WHEN 'high' THEN 0
            WHEN 'medium' THEN 1
            ELSE 2
          END,
          af.sort_order ASC,
          af.updated_at DESC
        LIMIT $${params.length}
      `,
      params,
    );

    return NextResponse.json({ rows: result.rows.map(mapRow) });
  } catch (error: any) {
    console.error('GET /api/admin/features error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin features', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = String(body?.title || '').trim();
    const description = String(body?.description || '').trim();
    const type = String(body?.type || 'feature').trim();
    const status = String(body?.status || 'backlog').trim();
    const priority = String(body?.priority || 'medium').trim();
    const pageArea = String(body?.pageArea || '').trim();
    const sortOrder = Number(body?.sortOrder ?? 100);
    const isActive = typeof body?.isActive === 'boolean' ? body.isActive : true;
    const assignedToStaffId = body?.assignedToStaffId == null || body?.assignedToStaffId === ''
      ? null
      : Number(body.assignedToStaffId);
    const staffId = body?.staffId == null || body?.staffId === ''
      ? null
      : Number(body.staffId);

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (!isFeatureType(type)) {
      return NextResponse.json({ error: 'Invalid feature type' }, { status: 400 });
    }
    if (!isFeatureStatus(status)) {
      return NextResponse.json({ error: 'Invalid feature status' }, { status: 400 });
    }
    if (!isFeaturePriority(priority)) {
      return NextResponse.json({ error: 'Invalid feature priority' }, { status: 400 });
    }
    if (assignedToStaffId != null && (!Number.isFinite(assignedToStaffId) || assignedToStaffId <= 0)) {
      return NextResponse.json({ error: 'Invalid assigned staff id' }, { status: 400 });
    }

    const result = await pool.query(
      `
        INSERT INTO admin_features (
          title,
          description,
          type,
          status,
          priority,
          page_area,
          sort_order,
          is_active,
          assigned_to_staff_id,
          created_by_staff_id,
          updated_by_staff_id,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NOW())
        RETURNING *
      `,
      [
        title,
        description || null,
        type,
        status,
        priority,
        pageArea || null,
        Number.isFinite(sortOrder) ? Math.max(0, Math.floor(sortOrder)) : 100,
        isActive,
        assignedToStaffId,
        staffId,
      ],
    );

    return NextResponse.json({ success: true, feature: mapRow(result.rows[0]) }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/admin/features error:', error);
    return NextResponse.json(
      { error: 'Failed to create admin feature', details: error?.message || 'Unknown error' },
      { status: 500 },
    );
  }
}
