import { NextRequest, NextResponse } from 'next/server';
import { getBinAuditHistory } from '@/lib/audit-log/entity-history';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit/bin/[id]?limit=200
 *
 * Per-bin audit timeline. Returns newest-first events from audit_logs
 * (field-level diffs) UNION inventory_events (lifecycle).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const binId = Number(id);
    if (!Number.isFinite(binId) || binId <= 0) {
      return NextResponse.json({ error: 'Invalid bin id' }, { status: 400 });
    }
    const limitParam = Number(req.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : 200;
    const events = await getBinAuditHistory(binId, { limit });
    return NextResponse.json({ success: true, bin_id: binId, events });
  } catch (err: any) {
    console.error('[GET /api/audit/bin/[id]] error:', err);
    return NextResponse.json(
      { error: 'Failed to load bin audit', details: err?.message },
      { status: 500 },
    );
  }
}
