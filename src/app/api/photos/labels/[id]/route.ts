import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  updateLabel,
  deleteLabel,
  LabelConflictError,
  LabelValidationError,
  LabelNotFoundError,
  LabelSystemGuardError,
} from '@/lib/photos/labels';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/** withAuth drops route params; the id is the last path segment (/api/photos/labels/{id}). */
function labelIdFromPath(req: NextRequest): number {
  const seg = req.nextUrl.pathname.split('/').filter(Boolean).pop() ?? '';
  return Number(seg);
}

/** PATCH /api/photos/labels/[id] — rename / recolor. Body: { label?, color?, icon? }. */
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  const id = labelIdFromPath(req);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid label id is required' }, { status: 400 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      label?: unknown;
      color?: unknown;
      icon?: unknown;
    };
    const updated = await updateLabel(ctx.organizationId, id, {
      label: typeof body.label === 'string' ? body.label : undefined,
      color: body.color === undefined ? undefined : typeof body.color === 'string' ? body.color : null,
      icon: body.icon === undefined ? undefined : typeof body.icon === 'string' ? body.icon : null,
    });

    await recordAudit(pool, ctx, req, {
      source: 'photo-labels-api',
      action: AUDIT_ACTION.PHOTO_LABEL_UPDATE,
      entityType: AUDIT_ENTITY.PHOTO_LABEL,
      entityId: updated.id,
      after: { label: updated.label, color: updated.color, icon: updated.icon },
    });

    return NextResponse.json({ label: updated });
  } catch (error) {
    if (error instanceof LabelNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof LabelSystemGuardError || error instanceof LabelConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LabelValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('PATCH /api/photos/labels/[id] failed:', error);
    return NextResponse.json({ error: 'Failed to update label' }, { status: 500 });
  }
}, { permission: 'photos.manage' });

/** DELETE /api/photos/labels/[id] — remove a custom label (system labels guarded). */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const id = labelIdFromPath(req);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Valid label id is required' }, { status: 400 });
  }
  try {
    await deleteLabel(ctx.organizationId, id);

    await recordAudit(pool, ctx, req, {
      source: 'photo-labels-api',
      action: AUDIT_ACTION.PHOTO_LABEL_DELETE,
      entityType: AUDIT_ENTITY.PHOTO_LABEL,
      entityId: id,
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof LabelNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof LabelSystemGuardError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('DELETE /api/photos/labels/[id] failed:', error);
    return NextResponse.json({ error: 'Failed to delete label' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
