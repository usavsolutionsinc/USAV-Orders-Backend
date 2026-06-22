import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { refreshAllSuggestions } from '@/lib/neon/pairing-queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/sku-catalog/refresh-suggestions  (Vercel cron, nightly)
 *
 * Rebuilds sku_pairing_suggestions for every catalog row that has any
 * un-paired, plausible candidate. Writes ONLY to sku_pairing_suggestions —
 * never touches sku_platform_ids.sku_catalog_id. Every actual pairing
 * remains human-reviewed via the Product Hub + /pair-batch endpoint.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('sku_catalog.refresh_suggestions', () =>
      withCronRun('sku_catalog.refresh_suggestions', async () => {
        const startedAt = Date.now();
        const r = await refreshAllSuggestions();
        return { ...r, durationMs: Date.now() - startedAt };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const result = locked.result!;
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'refresh-suggestions failed';
    console.error('[cron/refresh-suggestions] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
