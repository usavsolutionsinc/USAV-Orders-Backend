import { NextRequest, NextResponse } from 'next/server';
import { getBinsOverview } from '@/lib/neon/location-queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/bins-overview?room=…&q=…
 *
 * Aggregated bins list for the inventory hub. Returns one row per bin with
 * fill / stale / low / over-capacity flags pre-computed, plus the global
 * count buckets for the filter chips.
 */
export async function GET(req: NextRequest) {
  try {
    const room = req.nextUrl.searchParams.get('room');
    const q = req.nextUrl.searchParams.get('q');
    const data = await getBinsOverview({ room, q });
    return NextResponse.json({ success: true, ...data });
  } catch (err: any) {
    console.error('[GET /api/inventory/bins-overview] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to load bins overview' },
      { status: 500 },
    );
  }
}
