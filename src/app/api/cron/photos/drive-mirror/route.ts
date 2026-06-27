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
import { runDriveMirrorJob, selectPhotosForDriveMirror } from '@/lib/photos/mirror-drive';
import { isPhotosDriveBackupEnabled } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/photos/drive-mirror
 *
 * Backs up GCS-primary photos into each connected tenant's own Google Drive.
 * No-op for orgs without an active google_drive connection (the selection joins
 * organization_integrations). Mirrors the nas-mirror cron exactly.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isPhotosDriveBackupEnabled()) {
    return NextResponse.json({ success: true, skipped: 'disabled' });
  }

  const limit = Number(new URL(request.url).searchParams.get('limit') || 20);

  try {
    const locked = await withCronLock('photos.drive_mirror', () =>
      withCronRun('photos.drive_mirror', async () => {
        const candidates = await selectPhotosForDriveMirror(limit);
        for (const c of candidates) {
          await enqueuePhotoJob({
            photoId: c.photoId,
            organizationId: c.organizationId,
            jobType: 'export_drive',
          });
        }

        const jobs = await claimPendingJobs('export_drive', limit);
        let completed = 0;
        let failed = 0;
        for (const job of jobs) {
          try {
            await runDriveMirrorJob(job);
            await completePhotoJob(job.id);
            completed++;
          } catch (err) {
            failed++;
            await failPhotoJob(
              job.id,
              err instanceof Error ? err.message : 'drive mirror failed',
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
    console.error('[cron/photos/drive-mirror]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Drive mirror cron failed' },
      { status: 500 },
    );
  }
}
