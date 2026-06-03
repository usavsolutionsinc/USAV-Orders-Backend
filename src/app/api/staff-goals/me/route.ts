/**
 * GET /api/staff-goals/me — the logged-in staffer's own station goals.
 *
 * Returns the staffer's assigned stations (primary first) with live, deduped
 * today counts and daily targets. Drives the header goal chip. No special
 * permission — any authenticated staffer reads their OWN goals; staffId comes
 * from the verified session, never the request.
 *
 * Shape: { primary: Station | null, hasSwitch: boolean,
 *          stations: { station, is_primary, daily_goal, today_count }[] }
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { getMyStationGoals } from '@/lib/neon/staff-stations-queries';

export const runtime = 'nodejs';

export const GET = withAuth(async (_req, ctx) => {
  const stations = await getMyStationGoals(ctx.staffId);
  const primary = stations.find((s) => s.is_primary)?.station ?? stations[0]?.station ?? null;
  return NextResponse.json({
    primary,
    hasSwitch: stations.length > 1,
    stations,
  });
});
