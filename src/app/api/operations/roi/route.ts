import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { computeLaborThroughput } from '@/lib/operations/labor-throughput';

/**
 * GET /api/operations/roi — the first-week ROI proof.
 *
 * One org-scoped rollup the owner can glance at to SEE the throughput lift:
 *   - unitsThisWeek / unitsLastWeek / pctChange — captured throughput from
 *     workflow_node_stats.completed_count (the daily snapshot; no recompute).
 *     completed_count is per node-exit, so this is total stage-completions over
 *     the rolling 7-day window — the throughput series, not distinct units.
 *   - unitsPerLaborHour — the headline productivity number, from
 *     computeLaborThroughput over the last 7 days (units advanced / clocked hours).
 *   - avgCycleHoursByStage — mean time-in-node per stage, from workflow_runs.
 *   - unitsStuck — Σ(blocked + error) from the latest workflow_node_stats snapshot.
 *
 * Monitor archetype: org-scoped tenant reads only (tenantQuery + the labor helper
 * are all scoped to ctx.organizationId), never a cross-tenant rollup. Read-only —
 * no mutation, no audit. `operations.view` gates it (an existing read permission).
 */
export const GET = withAuth(async (_request: NextRequest, ctx) => {
  const orgId = ctx.organizationId;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  try {
    const [weekly, cycle, stuck, labor] = await Promise.all([
      // Captured throughput: this-week vs last-week completed_count sums.
      tenantQuery<{ this_week: number | string; last_week: number | string }>(
        orgId,
        `SELECT
            COALESCE(SUM(completed_count) FILTER (
              WHERE snapshot_date >= CURRENT_DATE - 7), 0)::int AS this_week,
            COALESCE(SUM(completed_count) FILTER (
              WHERE snapshot_date >= CURRENT_DATE - 14
                AND snapshot_date <  CURRENT_DATE - 7), 0)::int AS last_week
           FROM workflow_node_stats
          WHERE organization_id = $1
            AND snapshot_date >= CURRENT_DATE - 14`,
        [orgId],
      ),
      // Mean time-in-node per stage over the last 7 days (workflow_runs dwell).
      tenantQuery<{ stage: string; avg_cycle_hours: number | string; samples: number | string }>(
        orgId,
        `SELECT r.node_type AS stage,
                (AVG(r.duration_ms) / 3600000.0)::float8 AS avg_cycle_hours,
                COUNT(*)::int AS samples
           FROM workflow_runs r
          WHERE r.organization_id = $1
            AND r.duration_ms IS NOT NULL
            AND r.created_at >= NOW() - INTERVAL '7 days'
          GROUP BY r.node_type
          ORDER BY avg_cycle_hours DESC NULLS LAST`,
        [orgId],
      ),
      // Units stuck right now = blocked + error in the latest snapshot.
      tenantQuery<{ stuck: number | string }>(
        orgId,
        `SELECT COALESCE(SUM(blocked_count + error_count), 0)::int AS stuck
           FROM workflow_node_stats
          WHERE organization_id = $1
            AND snapshot_date = (
              SELECT MAX(snapshot_date) FROM workflow_node_stats WHERE organization_id = $1
            )`,
        [orgId],
      ),
      // Headline productivity over the last 7 days.
      computeLaborThroughput(orgId, { from: weekAgo, to: now }),
    ]);

    const unitsThisWeek = Number(weekly.rows[0]?.this_week ?? 0);
    const unitsLastWeek = Number(weekly.rows[0]?.last_week ?? 0);
    const pctChange =
      unitsLastWeek > 0
        ? Math.round(((unitsThisWeek - unitsLastWeek) / unitsLastWeek) * 1000) / 10
        : unitsThisWeek > 0
          ? 100
          : 0;

    const avgCycleHoursByStage = cycle.rows.map((r) => ({
      stage: r.stage,
      avgCycleHours: Math.round(Number(r.avg_cycle_hours ?? 0) * 100) / 100,
      samples: Number(r.samples ?? 0),
    }));

    const unitsStuck = Number(stuck.rows[0]?.stuck ?? 0);

    const hasData =
      unitsThisWeek > 0 ||
      unitsLastWeek > 0 ||
      unitsStuck > 0 ||
      labor.unitsProcessed > 0 ||
      labor.laborHours > 0 ||
      avgCycleHoursByStage.length > 0;

    return NextResponse.json({
      success: true,
      hasData,
      unitsThisWeek,
      unitsLastWeek,
      pctChange,
      unitsPerLaborHour: labor.unitsPerLaborHour,
      unitsProcessed: labor.unitsProcessed,
      laborHours: labor.laborHours,
      perStaff: labor.perStaff,
      avgCycleHoursByStage,
      unitsStuck,
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute ROI';
    console.error('operations/roi GET failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'operations.view' });
