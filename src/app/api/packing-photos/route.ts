import { NextRequest, NextResponse } from 'next/server';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  countPackerPhotos,
  getPackerPhotoLogId,
  listPackerPhotos,
} from '@/lib/photos/queries/packer-list';
import { resolvePhotoAccessUrl } from '@/lib/photos/resolve-access-url';
import { deletePhoto } from '@/lib/photos/service';
import { publishPackerPhotoChanged } from '@/lib/realtime/publish';

export const dynamic = 'force-dynamic';

/**
 * Packer photo endpoint — the packing mirror of `/api/receiving-photos`.
 *
 * Photos are stored polymorphically on the `photos` table, linked via
 * `photo_entity_links` with `entity_type='PACKER_LOG'`, `entity_id=packer_logs.id`.
 *
 *   GET    ?packerLogId=N   → every photo for that packer log (signed URLs)
 *   DELETE ?id=P            → remove one photo + live-refresh subscribers
 */

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const packerLogId = Number(new URL(req.url).searchParams.get('packerLogId'));
    if (!Number.isFinite(packerLogId) || packerLogId <= 0) {
      throw ApiError.badRequest('Valid packerLogId is required');
    }

    const rows = await listPackerPhotos({
      organizationId: ctx.organizationId,
      packerLogId,
    });

    const photos = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        photoUrl: await resolvePhotoAccessUrl(row.id, ctx.organizationId, 'full'),
        uploadedBy: row.uploadedBy,
        createdAt: row.createdAt,
      })),
    );

    return NextResponse.json({ photos });
  } catch (error) {
    return errorResponse(error, 'GET /api/packing-photos');
  }
}, { permission: 'packing.view' });

export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      throw ApiError.badRequest('Valid id is required');
    }

    const packerLogId = await getPackerPhotoLogId(id, ctx.organizationId);
    if (packerLogId == null) throw ApiError.notFound('photo', id);

    await deletePhoto(id, ctx.organizationId);

    await publishPackerPhotoChanged({
      organizationId: ctx.organizationId as OrgId,
      action: 'delete',
      packerLogId,
      photoId: id,
      totalPhotoCount: await countPackerPhotos(ctx.organizationId, packerLogId),
      source: 'packing-photos.delete',
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return errorResponse(error, 'DELETE /api/packing-photos');
  }
}, { permission: 'packing.complete_order' });
