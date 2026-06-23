import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { generatePhotoShareLinks } from '@/lib/photos/share-links';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/photos/share
 *
 * Mint short-lived, task-scoped read URLs for a set of selected library photos
 * (see `src/lib/photos/share-links.ts` for the security model). Returns the
 * links + the uniform expiry so the client can format them for the clipboard.
 *
 * Body: { photoIds: number[]; ttlSeconds?: number }
 * Guarded by `photos.share` — the same permission as durable share packs.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    // 1. Validate the body — ids are required; ttl is optional and clamped in the helper.
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const photoIds = Array.isArray(body.photoIds)
      ? body.photoIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (photoIds.length === 0) throw ApiError.badRequest('photoIds is required');

    const ttlSeconds =
      body.ttlSeconds != null && Number.isFinite(Number(body.ttlSeconds))
        ? Number(body.ttlSeconds)
        : undefined;

    // 2. Delegate to the domain helper (org-verifies ids, mints signed URLs).
    const result = await generatePhotoShareLinks({
      organizationId: ctx.organizationId,
      photoIds,
      ttlSeconds,
      appOrigin: req.nextUrl.origin,
    });

    if (result.links.length === 0) {
      throw ApiError.notFound('No shareable photos found');
    }

    // 3. Audit: who minted how many links, for which photos, and for how long.
    //    Never blocks the response (recordAudit swallows its own failures).
    await recordAudit(pool, ctx, req, {
      source: 'photo-library',
      action: AUDIT_ACTION.PHOTO_SHARE_LINK,
      entityType: AUDIT_ENTITY.PHOTO,
      entityId: result.links[0].photoId,
      method: 'manual',
      extra: {
        photo_ids: result.links.map((l) => l.photoId),
        count: result.links.length,
        signed_count: result.links.filter((l) => l.kind === 'signed').length,
        proxy_count: result.links.filter((l) => l.kind === 'proxy').length,
        missing_ids: result.missingIds,
        expires_at: result.expiresAt,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/share');
  }
}, { permission: 'photos.share' });
