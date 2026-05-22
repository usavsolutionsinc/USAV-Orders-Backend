import { NextRequest, NextResponse } from 'next/server';
import { isQStashOrigin } from '@/lib/qstash';
import { refreshAllSuggestions } from '@/lib/neon/pairing-queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/sku-catalog/refresh-suggestions
 *
 * Rebuilds sku_pairing_suggestions for every catalog row that has any
 * un-paired, plausible candidate. Writes ONLY to sku_pairing_suggestions —
 * never touches sku_platform_ids.sku_catalog_id. Every actual pairing
 * remains human-reviewed via the Product Hub + /pair-batch endpoint.
 *
 * Schedule: nightly via QStash (add to src/config/qstash-schedules.json).
 * Health probe: GET returns ok without doing work.
 */
export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const result = await refreshAllSuggestions();
    return NextResponse.json({
      success: true,
      ...result,
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'refresh-suggestions failed';
    console.error('[cron/refresh-suggestions] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    queue: 'qstash',
    job: 'sku-catalog/refresh-suggestions',
  });
}
