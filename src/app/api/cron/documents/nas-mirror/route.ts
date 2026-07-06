import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runOutboundDocumentNasMirrorBatch } from '@/lib/documents/mirror-nas';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/documents/nas-mirror
 *
 * Copies GCS-primary outbound documents (labels + slips) older than
 * DOCUMENTS_NAS_MIRROR_AFTER_DAYS (default 90) to NAS cold storage.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get('limit') || 20);

  try {
    const locked = await withCronLock('documents.nas_mirror', () =>
      withCronRun('documents.nas_mirror', async () => runOutboundDocumentNasMirrorBatch(limit)),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    return NextResponse.json({ success: true, ...summary });
  } catch (err: unknown) {
    console.error('[cron/documents/nas-mirror]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Document NAS mirror cron failed' },
      { status: 500 },
    );
  }
}
