import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import {
  createLabel,
  listLabels,
  LabelConflictError,
  LabelValidationError,
} from '@/lib/photos/labels';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/photos/labels — the org's photo-label vocabulary.
 * Optional `?scopeImageType=listing` narrows to that type's labels + globals.
 * Degrade-not-fail: returns [] (not a 500) if the table is not yet migrated, so
 * the library sidebar's Labels section just renders empty.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const scopeImageType = new URL(req.url).searchParams.get('scopeImageType')?.trim() || null;
  let labels: Awaited<ReturnType<typeof listLabels>> = [];
  try {
    labels = await listLabels(ctx.organizationId, { scopeImageType });
  } catch (error) {
    console.error('GET /api/photos/labels: labels unavailable:', error);
  }
  return NextResponse.json({ labels });
}, { permission: 'photos.view' });

/** POST /api/photos/labels — create a label. Body: { label, color?, icon?, scopeImageType? }. */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      label?: unknown;
      color?: unknown;
      icon?: unknown;
      scopeImageType?: unknown;
    };
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) {
      return NextResponse.json({ error: 'A name is required' }, { status: 400 });
    }
    const created = await createLabel(ctx.organizationId, {
      label,
      color: typeof body.color === 'string' ? body.color : null,
      icon: typeof body.icon === 'string' ? body.icon : null,
      scopeImageType: typeof body.scopeImageType === 'string' ? body.scopeImageType : null,
    });

    await recordAudit(pool, ctx, req, {
      source: 'photo-labels-api',
      action: AUDIT_ACTION.PHOTO_LABEL_CREATE,
      entityType: AUDIT_ENTITY.PHOTO_LABEL,
      entityId: created.id,
      after: { key: created.key, label: created.label, color: created.color },
    });

    return NextResponse.json({ label: created }, { status: 201 });
  } catch (error) {
    if (error instanceof LabelConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LabelValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('POST /api/photos/labels failed:', error);
    return NextResponse.json({ error: 'Failed to create label' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
