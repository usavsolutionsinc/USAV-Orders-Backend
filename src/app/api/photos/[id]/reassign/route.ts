import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';
import {
  PhotoReassignError,
  reassignReceivingPhoto,
} from '@/lib/photos/reassign-receiving-photo';
import { countReceivingPhotos } from '@/lib/photos/queries/receiving-list';
import { publishReceivingPhotoChanged } from '@/lib/realtime/publish';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

const RECEIVING_ENTITY_TYPES = new Set(['RECEIVING', 'RECEIVING_LINE']);

/**
 * PATCH /api/photos/[id]/reassign — move a receiving photo's primary entity
 * link to another PO (carton) or receiving line.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRoutePerm(request, 'receiving.upload_photo');
  if (gate.denied) return gate.denied;

  const { id: idParam } = await params;
  const photoId = Number(idParam);
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return NextResponse.json({ error: 'Valid photo id is required' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    entityType?: unknown;
    entityId?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const entityType = String(body.entityType || '').trim().toUpperCase();
  const entityId = Number(body.entityId);
  if (!RECEIVING_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json(
      { error: 'entityType must be RECEIVING or RECEIVING_LINE' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(entityId) || entityId <= 0) {
    return NextResponse.json({ error: 'Valid entityId is required' }, { status: 400 });
  }

  const orgId = gate.ctx.organizationId;

  try {
    const result = await reassignReceivingPhoto({
      organizationId: orgId,
      photoId,
      targetEntityType: entityType as 'RECEIVING' | 'RECEIVING_LINE',
      targetEntityId: entityId,
    });

    if (!result.idempotent) {
      await recordAudit(pool, gate.ctx, request, {
        source: 'photos-reassign-api',
        action: AUDIT_ACTION.PHOTO_REASSIGN,
        entityType: AUDIT_ENTITY.PHOTO,
        entityId: photoId,
        before: {
          receivingId: result.from.receivingId,
          receivingLineId: result.from.receivingLineId,
          entityType: result.from.entityType,
          entityId: result.from.entityId,
        },
        after: {
          receivingId: result.to.receivingId,
          receivingLineId: result.to.receivingLineId,
          entityType: result.to.entityType,
          entityId: result.to.entityId,
        },
      });

      after(async () => {
        const org = orgId as OrgId;
        const [fromCount, toCount] = await Promise.all([
          countReceivingPhotos(org, result.from.receivingId),
          countReceivingPhotos(org, result.to.receivingId),
        ]);
        await publishReceivingPhotoChanged({
          organizationId: org,
          action: 'delete',
          receivingId: result.from.receivingId,
          receivingLineId: result.from.receivingLineId,
          photoId,
          totalPhotoCount: fromCount,
          source: 'photos.reassign.from',
        });
        await publishReceivingPhotoChanged({
          organizationId: org,
          action: 'insert',
          receivingId: result.to.receivingId,
          receivingLineId: result.to.receivingLineId,
          photoId,
          totalPhotoCount: toCount,
          source: 'photos.reassign.to',
        });
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof PhotoReassignError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('PATCH /api/photos/[id]/reassign failed:', error);
    return NextResponse.json({ error: 'Failed to reassign photo' }, { status: 500 });
  }
}
