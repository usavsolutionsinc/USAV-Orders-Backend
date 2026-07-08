import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Receiving-lines COUNTS sibling (station-table-unification-plan §5 / §7.2).
 *
 * A lightweight `{ total, byDay }` tally over `receiving_lines` filtered ONLY by
 * REAL indexed columns (tenant, `created_at` range, optional `assigned_tech_id`
 * and `workflow_status`) — so the SQL is unambiguously correct and never diverges
 * from a forked copy of the 2000-line list route's view-mode WHERE (Decision 3).
 * View-specific lane counts (incoming delivery facets, testing verdicts) are
 * DERIVED CARRIER/read-time state, not raw columns, so they are re-derived
 * client-side from the lane SoT (Decision 12) — this endpoint intentionally does
 * not attempt them.
 *
 * GET /api/receiving-lines/counts?weekStart=&weekEnd=&staff=&workflowStatus=
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  const { searchParams } = new URL(req.url);
  const orgId = ctx.organizationId;
  const weekStart = searchParams.get('weekStart') || '';
  const weekEnd = searchParams.get('weekEnd') || '';
  const staffParam = Number(searchParams.get('staff'));
  const staffId = Number.isFinite(staffParam) && staffParam > 0 ? staffParam : null;
  const workflowStatus = (searchParams.get('workflowStatus') || '').trim();

  try {
    const params: (string | number)[] = [orgId];
    const conditions: string[] = [];
    if (weekStart) {
      params.push(weekStart);
      conditions.push(`rl.created_at >= ($${params.length}::date - INTERVAL '1 day')`);
    }
    if (weekEnd) {
      params.push(weekEnd);
      conditions.push(`rl.created_at < ($${params.length}::date + INTERVAL '2 days')`);
    }
    if (staffId != null) {
      params.push(staffId);
      conditions.push(`rl.assigned_tech_id = $${params.length}`);
    }
    if (workflowStatus) {
      params.push(workflowStatus);
      conditions.push(`rl.workflow_status = $${params.length}`);
    }
    const extraWhere = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT
        to_char(rl.created_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM receiving_lines rl
      WHERE rl.organization_id = $1
        ${extraWhere}
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
    console.error('Error fetching receiving-line counts:', error);
    return NextResponse.json({ error: 'Failed to fetch receiving-line counts', details: error?.message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
