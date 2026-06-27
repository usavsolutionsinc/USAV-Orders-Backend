import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { getPhotoLabelIds, setPhotoLabels, LabelNotFoundError } from '@/lib/photos/labels';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Path is /api/photos/{id}/labels — the id is the segment before "labels". */
function photoIdFromPath(req: NextRequest): number {
  const segs = req.nextUrl.pathname.split('/').filter(Boolean);
  const labelsIdx = segs.lastIndexOf('labels');
  return Number(segs[labelsIdx - 1]);
}

/** GET /api/photos/[id]/labels — the label ids currently on this photo. */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const photoId = photoIdFromPath(req);
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return NextResponse.json({ error: 'Valid photo id is required' }, { status: 400 });
  }
  const labelIds = await getPhotoLabelIds(ctx.organizationId, photoId);
  return NextResponse.json({ labelIds });
}, { permission: 'photos.view' });

/** PUT /api/photos/[id]/labels — replace this photo's label set. Body: { labelIds: number[] }. */
export const PUT = withAuth(async (req: NextRequest, ctx) => {
  const photoId = photoIdFromPath(req);
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return NextResponse.json({ error: 'Valid photo id is required' }, { status: 400 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { labelIds?: unknown };
    const labelIds = Array.isArray(body.labelIds)
      ? body.labelIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];

    const labels = await setPhotoLabels(ctx.organizationId, photoId, labelIds, ctx.staffId);

    await recordAudit(pool, ctx, req, {
      source: 'photo-labels-api',
      action: AUDIT_ACTION.PHOTO_LABELS_SET,
      entityType: AUDIT_ENTITY.PHOTO,
      entityId: photoId,
      after: { labelIds: labels.map((l) => l.id) },
    });

    return NextResponse.json({ labels });
  } catch (error) {
    if (error instanceof LabelNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('PUT /api/photos/[id]/labels failed:', error);
    return NextResponse.json({ error: 'Failed to set labels' }, { status: 500 });
  }
}, { permission: 'photos.manage' });
