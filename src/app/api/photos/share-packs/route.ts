import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { createSharePack } from '@/lib/photos/share-packs';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) throw ApiError.badRequest('Invalid JSON body');

    const photoIds = Array.isArray(body.photoIds)
      ? body.photoIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    const title = String(body.title || '').trim();
    if (!title) throw ApiError.badRequest('title is required');
    if (photoIds.length === 0) throw ApiError.badRequest('photoIds is required');

    const result = await createSharePack(
      {
        organizationId: ctx.organizationId,
        staffId: ctx.staffId,
        photoIds,
        title,
        packType: body.packType,
        poRef: body.poRef ?? null,
        receivingId: body.receivingId ?? null,
        zendeskTicketId: body.zendeskTicketId ?? null,
        expiresInDays: body.expiresInDays,
        filenamePrefix: body.filenamePrefix,
      },
      req.nextUrl.origin,
    );

    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/share-packs');
  }
}, { permission: 'photos.share' });
