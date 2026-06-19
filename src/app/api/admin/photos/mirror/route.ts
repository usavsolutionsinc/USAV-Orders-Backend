import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import { enqueuePhotoJob } from '@/lib/photos/jobs';
import { selectPhotosForNasMirror } from '@/lib/photos/mirror-nas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/photos/mirror
 * Enqueue NAS mirror jobs for GCS-primary photos missing a NAS copy.
 * Optional body: { photoId?: number, limit?: number, skipAgeGate?: boolean }
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      photoId?: number;
      limit?: number;
      skipAgeGate?: boolean;
    };

    if (body.photoId != null && Number.isFinite(body.photoId) && body.photoId > 0) {
      await enqueuePhotoJob({
        photoId: body.photoId,
        organizationId: ctx.organizationId,
        jobType: 'nas_mirror',
      });
      return NextResponse.json({ success: true, enqueued: 1 });
    }

    const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);
    const candidates = await selectPhotosForNasMirror(limit, {
      organizationId: ctx.organizationId,
      skipAgeGate: body.skipAgeGate === true,
    });

    for (const row of candidates) {
      await enqueuePhotoJob({
        photoId: row.photoId,
        organizationId: row.organizationId,
        jobType: 'nas_mirror',
      });
    }

    return NextResponse.json({ success: true, enqueued: candidates.length });
  } catch (error) {
    return errorResponse(error, 'POST /api/admin/photos/mirror');
  }
}, { permission: 'admin.view' });
