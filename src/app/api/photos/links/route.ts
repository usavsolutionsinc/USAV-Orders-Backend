import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { linkPhoto } from '@/lib/photos/service';
import { uploadPermissionFor } from '@/lib/photos/entity-permissions';
import type { PhotoEntityType, PhotoLinkRole } from '@/lib/photos/types';
import { PHOTO_ENTITY_TYPES, PHOTO_LINK_ROLES } from '@/lib/photos/types';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const photoId = Number(body.photoId);
    const entityType = String(body.entityType || '').trim().toUpperCase() as PhotoEntityType;
    const entityId = Number(body.entityId);
    const linkRole = String(body.linkRole || 'primary').trim() as PhotoLinkRole;

    if (!Number.isFinite(photoId) || photoId <= 0) {
      throw ApiError.badRequest('Valid photoId is required');
    }
    if (!PHOTO_ENTITY_TYPES.includes(entityType)) {
      throw ApiError.badRequest(`Invalid entityType: ${entityType}`);
    }
    if (!Number.isFinite(entityId) || entityId <= 0) {
      throw ApiError.badRequest('Valid entityId is required');
    }
    if (!PHOTO_LINK_ROLES.includes(linkRole)) {
      throw ApiError.badRequest(`Invalid linkRole: ${linkRole}`);
    }

    const requiredPerm = uploadPermissionFor(entityType);
    if (!ctx.permissions.has(requiredPerm)) {
      return NextResponse.json(
        { error: 'FORBIDDEN', permission: requiredPerm },
        { status: 403 },
      );
    }

    await linkPhoto({
      organizationId: ctx.organizationId,
      photoId,
      entityType,
      entityId,
      linkRole,
    });

    return NextResponse.json({ success: true, photoId, entityType, entityId, linkRole });
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/links');
  }
}, {});
