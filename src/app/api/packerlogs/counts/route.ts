import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { fetchPackerLogRows } from '@/lib/neon/packer-logs-week';
import { toPSTDateKey } from '@/utils/date';

/**
 * Packer-logs COUNTS sibling (station-table-unification-plan §5 / §7.2). Reuses
 * the SAME query builder as the list route (`fetchPackerLogRows`) — Decision 3,
 * single SoT, no forked SQL — and derives `{ total, byDay }` from the bounded row
 * set (at the typical 10–50 rows/week the download is trivial; `truncated` flags
 * the ceiling for a future cheap-COUNT optimization). Lane counts re-derive
 * client-side from the TS lane SoT (Decision 12).
 *
 * GET /api/packerlogs/counts?packedBy=&weekStart=&weekEnd=&staff=
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const packerIdParam = searchParams.get('packerId') || searchParams.get('packedBy');
  const testedByParam = searchParams.get('testedBy');
  const staffParam = searchParams.get('staff');
  const weekStart = searchParams.get('weekStart') || '';
  const weekEnd = searchParams.get('weekEnd') || '';

  const packerIdNum = packerIdParam ? parseInt(packerIdParam) : null;
  const testedByNum = testedByParam ? parseInt(testedByParam) : null;
  const staffNum = staffParam ? parseInt(staffParam) : null;

  try {
    const { rows } = await fetchPackerLogRows({
      organizationId: ctx.organizationId,
      packerId: packerIdNum != null && !Number.isNaN(packerIdNum) ? packerIdNum : null,
      testedBy: testedByNum != null && !Number.isNaN(testedByNum) ? testedByNum : null,
      staffId: staffNum != null && !Number.isNaN(staffNum) ? staffNum : null,
      limit: 500,
      offset: 0,
      weekStart,
      weekEnd,
    });

    const byDay: Record<string, number> = {};
    for (const r of rows) {
      let day = 'Unknown';
      try {
        day = toPSTDateKey(r.created_at) || 'Unknown';
      } catch {
        day = 'Unknown';
      }
      byDay[day] = (byDay[day] ?? 0) + 1;
    }

    return NextResponse.json({ total: rows.length, byDay, truncated: rows.length >= 500 });
  } catch (error: any) {
    console.error('Error fetching packer-log counts:', error);
    return NextResponse.json({ error: 'Failed to fetch packer-log counts', details: error?.message }, { status: 500 });
  }
}, { permission: 'packing.view' });
