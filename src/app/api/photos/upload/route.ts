import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { uploadPhoto } from '@/lib/photos/service';
import { uploadPermissionFor } from '@/lib/photos/entity-permissions';
import type { PhotoEntityType, PhotoLinkRole } from '@/lib/photos/types';
import { PHOTO_ENTITY_TYPES, PHOTO_LINK_ROLES } from '@/lib/photos/types';
import {
  publishReceivingPhotoChanged,
  publishPackerPhotoChanged,
  publishUnitPhotoChanged,
} from '@/lib/realtime/publish';
import type { OrgId } from '@/lib/tenancy/constants';
import { resolvePhotoAccessUrl } from '@/lib/photos/resolve-access-url';
import { countPackerPhotos } from '@/lib/photos/queries/packer-list';
import { countReceivingPhotos } from '@/lib/photos/queries/receiving-list';
import { countUnitPhotos } from '@/lib/photos/queries/unit-list';
import { tenantQuery } from '@/lib/tenancy/db';

export const dynamic = 'force-dynamic';

function parseEntityType(raw: FormDataEntryValue | null): PhotoEntityType {
  const value = String(raw || '').trim().toUpperCase();
  if (!PHOTO_ENTITY_TYPES.includes(value as PhotoEntityType)) {
    throw ApiError.badRequest(`Invalid entityType: ${value}`);
  }
  return value as PhotoEntityType;
}

function parseLinkRole(raw: FormDataEntryValue | null): PhotoLinkRole | undefined {
  const value = String(raw || '').trim();
  if (!value) return undefined;
  if (!PHOTO_LINK_ROLES.includes(value as PhotoLinkRole)) {
    throw ApiError.badRequest(`Invalid linkRole: ${value}`);
  }
  return value as PhotoLinkRole;
}

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const form = await req.formData();
    const entityType = parseEntityType(form.get('entityType'));
    const entityId = Number(form.get('entityId'));
    if (!Number.isFinite(entityId) || entityId <= 0) {
      throw ApiError.badRequest('Valid entityId is required');
    }

    const requiredPerm = uploadPermissionFor(entityType);
    if (!ctx.permissions.has(requiredPerm)) {
      return NextResponse.json(
        { error: 'FORBIDDEN', permission: requiredPerm },
        { status: 403 },
      );
    }

    const file = form.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      throw ApiError.badRequest('file is required');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'image/jpeg';
    const photoType = String(form.get('photoType') || '').trim() || null;
    const poRef = String(form.get('poRef') || '').trim() || null;
    const linkRole = parseLinkRole(form.get('linkRole'));

    const result = await uploadPhoto({
      organizationId: ctx.organizationId,
      staffId: ctx.staffId,
      entityType,
      entityId,
      photoType,
      linkRole,
      poRef,
      fileBuffer: buffer,
      contentType,
      useStorageAdapter: true,
    });

    const displayUrl = await resolvePhotoAccessUrl(result.id, ctx.organizationId, 'full');
    const thumbUrl = await resolvePhotoAccessUrl(result.id, ctx.organizationId, 'thumb');

    if (entityType === 'RECEIVING' || entityType === 'RECEIVING_LINE') {
      const receivingId =
        entityType === 'RECEIVING'
          ? entityId
          : await resolveReceivingId(entityId, ctx.organizationId);
      if (receivingId) {
        await publishReceivingPhotoChanged({
          organizationId: ctx.organizationId as OrgId,
          action: 'insert',
          receivingId,
          receivingLineId: entityType === 'RECEIVING_LINE' ? entityId : null,
          photoId: result.id,
          totalPhotoCount: await countReceivingPhotos(ctx.organizationId, receivingId),
          source: 'photos.upload',
        });
      }
    } else if (entityType === 'PACKER_LOG') {
      await publishPackerPhotoChanged({
        organizationId: ctx.organizationId as OrgId,
        action: 'insert',
        packerLogId: entityId,
        orderId: poRef,
        photoId: result.id,
        totalPhotoCount: await countPackerPhotos(ctx.organizationId, entityId),
        source: 'photos.upload',
      });
    } else if (entityType === 'SERIAL_UNIT') {
      await publishUnitPhotoChanged({
        organizationId: ctx.organizationId as OrgId,
        action: 'insert',
        serialUnitId: entityId,
        photoId: result.id,
        totalPhotoCount: await countUnitPhotos(ctx.organizationId, entityId),
        source: 'photos.upload',
      });
    }

    return NextResponse.json({
      ...result,
      url: displayUrl,
      thumbUrl,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/upload');
  }
}, {});

async function resolveReceivingId(
  lineId: number,
  organizationId: string,
): Promise<number | null> {
  const r = await tenantQuery<{ receiving_id: number }>(
    organizationId,
    `SELECT receiving_id FROM receiving_lines WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [lineId, organizationId],
  );
  return r.rows[0]?.receiving_id ?? null;
}
