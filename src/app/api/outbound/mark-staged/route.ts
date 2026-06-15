import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import {
  listDockStagingCandidateShipmentIds,
  markShipmentsDockStaged,
  resolveStaffIdByName,
} from '@/lib/outbound/dock-staging';

/**
 * POST /api/outbound/mark-staged — bulk-record DOCK_STAGED for packed packages
 * sitting in the outbound lane that have not yet been scanned out.
 *
 * Body (optional): `{ staffId?: number, staffName?: string }` — defaults to the
 * signed-in operator; pass `staffName: "Mike"` for the launch-day backfill.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const staffName = String(body?.staffName ?? '').trim();
  let staffId = Number(body?.staffId ?? ctx.staffId);

  if (!Number.isFinite(staffId) || staffId <= 0) {
    if (staffName) {
      const resolved = await resolveStaffIdByName(ctx.organizationId, staffName);
      if (resolved) staffId = resolved;
    }
  }

  if (!Number.isFinite(staffId) || staffId <= 0) {
    return NextResponse.json({ error: 'Valid staffId or staffName required' }, { status: 400 });
  }

  const shipmentIds = await listDockStagingCandidateShipmentIds(ctx.organizationId);
  const marked = await markShipmentsDockStaged(ctx.organizationId, staffId, shipmentIds);

  await invalidateCacheTags(['api:orders']);

  return NextResponse.json({
    ok: true,
    marked,
    staffId,
    candidates: shipmentIds.length,
  });
}, { permission: 'shipping.mark_shipped' });
