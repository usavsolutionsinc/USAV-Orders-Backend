import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import {
  claimPendingJobs,
  completePhotoJob,
  enqueuePhotoJob,
  failPhotoJob,
} from '@/lib/photos/jobs';
import { runNasMirrorJob, selectPhotosForNasMirror } from '@/lib/photos/mirror-nas';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/photos/nas-mirror
 *
 * Copies GCS-primary photos older than PHOTOS_NAS_MIRROR_AFTER_DAYS to NAS cold storage.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get('limit') || 20);

  try {
    const locked = await withCronLock('photos.nas_mirror', () =>
      withCronRun('photos.nas_mirror', async () => {
        const candidates = await selectPhotosForNasMirror(limit);
        for (const c of candidates) {
          await enqueuePhotoJob({
            photoId: c.photoId,
            organizationId: c.organizationId,
            jobType: 'nas_mirror',
          });
        }

        const jobs = await claimPendingJobs('nas_mirror', limit);
        let completed = 0;
        let failed = 0;
        for (const job of jobs) {
          try {
            await runNasMirrorJob(job);
            await completePhotoJob(job.id);
            completed++;
          } catch (err) {
            failed++;
            await failPhotoJob(
              job.id,
              err instanceof Error ? err.message : 'nas mirror failed',
              job.attempts,
            );
          }
        }
        return { candidates: candidates.length, claimed: jobs.length, completed, failed };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    return NextResponse.json({ success: true, ...summary });
  } catch (err: unknown) {
    console.error('[cron/photos/nas-mirror]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'NAS mirror cron failed' },
      { status: 500 },
    );
  }
}
