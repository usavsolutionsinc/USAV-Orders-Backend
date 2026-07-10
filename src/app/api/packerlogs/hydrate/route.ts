import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { fetchPackerLogHydration } from '@/lib/neon/packer-logs-hydrate';

/**
 * Spine-first hydration for the shipped table. The main `/api/packerlogs` spine
 * response paints immediately without the display-only work_assignments fields
 * and photos; the client posts the visible page's station_activity_logs ids here
 * to fill them in. Read-only (no audit), org-scoped via ctx.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawIds = (body as { salIds?: unknown })?.salIds;
  const salIds = Array.isArray(rawIds)
    ? rawIds.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : [];

  if (salIds.length === 0) return NextResponse.json({});

  // Bound the batch (spine page size is 1000; leave headroom for "Load more"
  // stacks) so a bad caller can't ask for an unbounded IN-list.
  const bounded = salIds.slice(0, 4000);

  try {
    const map = await fetchPackerLogHydration({ organizationId: ctx.organizationId, salIds: bounded });
    return NextResponse.json(map, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error: any) {
    console.error('Error hydrating packer logs:', error);
    return NextResponse.json({ error: 'Failed to hydrate', details: error?.message }, { status: 500 });
  }
}, { permission: 'packing.view' });
