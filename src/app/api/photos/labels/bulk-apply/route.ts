import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { bulkApplyLabels } from '@/lib/photos/labels';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/photos/labels/bulk-apply — add/remove labels across many photos
 * (the selection-toolbar action). Body: { photoIds, addLabelIds?, removeLabelIds? }.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      photoIds?: unknown;
      addLabelIds?: unknown;
      removeLabelIds?: unknown;
    };
    const toIds = (v: unknown): number[] =>
      Array.isArray(v) ? v.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];

    const photoIds = toIds(body.photoIds);
    const addLabelIds = toIds(body.addLabelIds);
    const removeLabelIds = toIds(body.removeLabelIds);
    if (photoIds.length === 0) {
      return NextResponse.json({ error: 'photoIds is required' }, { status: 400 });
    }
    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      return NextResponse.json({ error: 'Nothing to apply' }, { status: 400 });
    }

    const result = await bulkApplyLabels(
      ctx.organizationId,
      photoIds,
      addLabelIds,
      removeLabelIds,
      ctx.staffId,
    );

    await recordAudit(pool, ctx, req, {
      source: 'photo-labels-api',
      action: AUDIT_ACTION.PHOTO_LABELS_BULK_APPLY,
      entityType: AUDIT_ENTITY.PHOTO,
      entityId: photoIds[0],
      after: { photos: result.photos, addLabelIds, removeLabelIds },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('POST /api/photos/labels/bulk-apply failed:', error);
    return NextResponse.json({ error: 'Failed to apply labels' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
