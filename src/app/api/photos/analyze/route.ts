import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { ApiError, errorResponse } from '@/lib/api';
import { enqueuePhotoJob } from '@/lib/photos/jobs';

export const dynamic = 'force-dynamic';

/** POST /api/photos/analyze — enqueue up to 10 photos for AI analysis (manual re-run). */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json().catch(() => null);
    const photoIds = Array.isArray(body?.photoIds)
      ? body.photoIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (photoIds.length === 0) throw ApiError.badRequest('photoIds is required');
    if (photoIds.length > 10) throw ApiError.badRequest('Maximum 10 photos per request');

    for (const photoId of photoIds) {
      await enqueuePhotoJob({
        photoId,
        organizationId: ctx.organizationId,
        jobType: 'analyze',
      });
    }

    return NextResponse.json({ success: true, enqueued: photoIds.length });
  } catch (error) {
    return errorResponse(error, 'POST /api/photos/analyze');
  }
}, { permission: 'photos.view' });
