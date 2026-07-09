import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Tech-logs COUNTS sibling (station-table-unification-plan §5 / §7.2).
 *
 * A lightweight tally for the sidebar legend + lane bubble headers WITHOUT a full
 * row download — a `COUNT(*)` over the SAME base table + WHERE the list route
 * (`/api/tech/logs`) uses (`station_activity_logs`, `station='TECH'`, the two
 * tech activity types, staff + tenant scope, optional week range), grouped by PST
 * day. Lane counts are re-derived client-side from the TS lane SoT (Decision 12 —
 * lane membership is not re-implemented in SQL for display); this endpoint returns
 * only raw, indexed-column aggregates.
 *
 * GET /api/tech/logs/counts?weekStart=&weekEnd=  — defaults to the signed-in staff;
 *   admin.view_logs holders may pass ?techId=N.
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const techIdParam = Number(searchParams.get('techId'));
  const isAdminFilter = Number.isFinite(techIdParam) && techIdParam > 0 && ctx.permissions.has('admin.view_logs');
  const techId = isAdminFilter ? techIdParam : ctx.staffId;
  const orgId = ctx.organizationId;
  const weekStart = searchParams.get('weekStart') || '';
  const weekEnd = searchParams.get('weekEnd') || '';

  if (!techId) {
    return NextResponse.json({ error: 'techId is required' }, { status: 400 });
  }

  try {
    // Same tenant-scoped params + 1-day date buffer as the list route.
    const params: (string | number)[] = [techId, orgId];
    const orgIdx = 2;
    const dateConditions: string[] = [];
    if (weekStart) {
      params.push(weekStart);
      dateConditions.push(`sal.created_at >= ($${params.length}::date - INTERVAL '1 day')`);
    }
    if (weekEnd) {
      params.push(weekEnd);
      dateConditions.push(`sal.created_at < ($${params.length}::date + INTERVAL '2 days')`);
    }
    const dateWhere = dateConditions.length > 0 ? `AND ${dateConditions.join(' AND ')}` : '';

    const query = `
      SELECT
        to_char(sal.created_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM station_activity_logs sal
      WHERE sal.station = 'TECH'
        AND sal.activity_type IN ('TRACKING_SCANNED', 'FNSKU_SCANNED')
        AND sal.staff_id = $1
        AND sal.organization_id = $${orgIdx}
        ${dateWhere}
      GROUP BY day
      ORDER BY day DESC
    `;

    const result = await tenantQuery<{ day: string | null; count: number }>(orgId, query, params);
    const byDay: Record<string, number> = {};
    let total = 0;
    for (const r of result.rows) {
      const day = r.day ?? 'Unknown';
      byDay[day] = (byDay[day] ?? 0) + Number(r.count);
      total += Number(r.count);
    }

    return NextResponse.json({ total, byDay, truncated: false });
  } catch (error: any) {
    console.error('Error fetching tech-log counts:', error);
    return NextResponse.json({ error: 'Failed to fetch tech-log counts', details: error?.message }, { status: 500 });
  }
}, { permission: 'tech.view' });
