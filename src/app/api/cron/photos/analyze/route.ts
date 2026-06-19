import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import {
  claimPendingJobs,
  completePhotoJob,
  enqueuePhotoJob,
  failPhotoJob,
} from '@/lib/photos/jobs';
import { runAnalyzeJob, isAnalyzeEnabled } from '@/lib/photos/analyze';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/cron/photos/analyze
 *
 * Processes pending photo_jobs (job_type=analyze). Enqueued on GCS upload.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get('limit') || 10);

  if (!isAnalyzeEnabled()) {
    return NextResponse.json({ success: true, skipped: true, reason: 'PHOTOS_ANALYZE_ENABLED=false' });
  }

  try {
    const summary = await withCronRun('photos.analyze', async () => {
      const jobs = await claimPendingJobs('analyze', limit);
      let completed = 0;
      let failed = 0;
      for (const job of jobs) {
        try {
          await runAnalyzeJob(job);
          await completePhotoJob(job.id);
          completed++;
        } catch (err) {
          failed++;
          await failPhotoJob(
            job.id,
            err instanceof Error ? err.message : 'analyze failed',
            job.attempts,
          );
        }
      }
      return { claimed: jobs.length, completed, failed };
    });
    return NextResponse.json({ success: true, ...summary });
  } catch (err: unknown) {
    console.error('[cron/photos/analyze]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Analyze cron failed' },
      { status: 500 },
    );
  }
}

/** POST — enqueue analyze jobs for explicit photo ids (staff/cron repair). */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    photoIds?: number[];
    organizationId?: string;
  } | null;
  const ids = Array.isArray(body?.photoIds)
    ? body.photoIds.filter((n) => Number.isFinite(n) && n > 0).slice(0, 10)
    : [];
  const orgId = body?.organizationId;
  if (!orgId || ids.length === 0) {
    return NextResponse.json({ error: 'organizationId and photoIds required' }, { status: 400 });
  }
  for (const photoId of ids) {
    await enqueuePhotoJob({ photoId, organizationId: orgId, jobType: 'analyze' });
  }
  return NextResponse.json({ success: true, enqueued: ids.length });
}
