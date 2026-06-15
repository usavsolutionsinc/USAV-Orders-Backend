import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';

/**
 * GET /api/quality/dashboard — aggregate quality/risk analytics for the admin
 * Quality tab: risk distribution + avg score, top open failure modes, repair
 * rollup (counts + cost), and the highest-risk units worklist.
 *
 * All read-only aggregates; the high-risk list rides the
 * (risk_level, quality_score) index on unit_quality_scores.
 *
 * Tenant scoping: unit_quality_scores / unit_failure_tags / failure_modes have
 * no organization_id column, so they are scoped through their serial_units
 * parent (JOIN + su.organization_id filter). unit_repairs carries its own
 * organization_id. Every read also runs GUC-wrapped via tenantQuery.
 */
export const GET = withAuth(async (_req, ctx) => {
  try {
    const orgId = ctx.organizationId;
    const [risk, failures, repairs, highRisk] = await Promise.all([
      // unit_quality_scores has no org column → scope via serial_units parent.
      tenantQuery<{ risk_level: string; n: number; avg: number }>(
        orgId,
        `SELECT q.risk_level, COUNT(*)::int AS n, ROUND(AVG(q.quality_score))::int AS avg
           FROM unit_quality_scores q
           JOIN serial_units su ON su.id = q.serial_unit_id
          WHERE su.organization_id = $1
          GROUP BY q.risk_level`,
        [orgId],
      ),
      // unit_failure_tags / failure_modes have no org column → scope via the
      // serial_units parent of the failure tag.
      tenantQuery(
        orgId,
        `SELECT fm.id, fm.code, fm.label, fm.severity, COUNT(*)::int AS open_count
           FROM unit_failure_tags t
           JOIN serial_units su ON su.id = t.serial_unit_id
           JOIN failure_modes fm ON fm.id = t.failure_mode_id
          WHERE t.resolution_status = 'open'
            AND su.organization_id = $1
          GROUP BY fm.id, fm.code, fm.label, fm.severity
          ORDER BY open_count DESC, fm.label
          LIMIT 12`,
        [orgId],
      ),
      // unit_repairs carries organization_id directly.
      tenantQuery<{ status: string; n: number; cost: string }>(
        orgId,
        `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(cost_cents), 0)::text AS cost
           FROM unit_repairs
          WHERE organization_id = $1
          GROUP BY status`,
        [orgId],
      ),
      // unit_quality_scores has no org column → scope via serial_units parent.
      tenantQuery(
        orgId,
        `SELECT q.serial_unit_id, su.serial_number, su.sku, su.unit_uid,
                q.quality_score, q.risk_level, q.risk_reasons, q.grade_at_score::text AS grade
           FROM unit_quality_scores q
           JOIN serial_units su ON su.id = q.serial_unit_id
          WHERE q.risk_level = 'high'
            AND su.organization_id = $1
          ORDER BY q.quality_score ASC, q.computed_at DESC
          LIMIT 25`,
        [orgId],
      ),
    ]);

    const riskBuckets = { low: 0, medium: 0, high: 0 } as Record<string, number>;
    let scored = 0;
    let weighted = 0;
    for (const r of risk.rows) {
      riskBuckets[r.risk_level] = r.n;
      scored += r.n;
      weighted += r.avg * r.n;
    }
    const avgScore = scored > 0 ? Math.round(weighted / scored) : null;

    const repairByStatus: Record<string, number> = {};
    let totalRepairCost = 0;
    for (const r of repairs.rows) {
      repairByStatus[r.status] = r.n;
      totalRepairCost += Number(r.cost);
    }

    return NextResponse.json({
      ok: true,
      risk: { ...riskBuckets, total: scored, avg_score: avgScore },
      top_failures: failures.rows,
      repairs: { by_status: repairByStatus, total_cost_cents: totalRepairCost },
      high_risk_units: highRisk.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load quality dashboard';
    console.error('[GET /api/quality/dashboard] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.view' });
