import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { uploadPhoto, isAdapterUploadEnabled } from '@/lib/photos/service';
import { uploadPermissionFor } from '@/lib/photos/entity-permissions';
import type { PhotoEntityType, PhotoLinkRole } from '@/lib/photos/types';
import { PHOTO_ENTITY_TYPES, PHOTO_LINK_ROLES } from '@/lib/photos/types';
import { publishReceivingPhotoChanged } from '@/lib/realtime/publish';
import type { OrgId } from '@/lib/tenancy/constants';

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
      useStorageAdapter: isAdapterUploadEnabled(),
    });

    if (entityType === 'RECEIVING' || entityType === 'RECEIVING_LINE') {
      const receivingId =
        entityType === 'RECEIVING'
          ? entityId
          : await resolveReceivingId(entityId);
      if (receivingId) {
        await publishReceivingPhotoChanged({
          organizationId: ctx.organizationId as OrgId,
          action: 'insert',
          receivingId,
          receivingLineId: entityType === 'RECEIVING_LINE' ? entityId : null,
          photoId: result.id,
          source: 'photos.upload',
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/upload');
  }
}, {});

async function resolveReceivingId(lineId: number): Promise<number | null> {
  const pool = (await import('@/lib/db')).default;
  const r = await pool.query<{ receiving_id: number }>(
    `SELECT receiving_id FROM receiving_lines WHERE id = $1 LIMIT 1`,
    [lineId],
  );
  return r.rows[0]?.receiving_id ?? null;
}
