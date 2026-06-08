import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';

/**
 * GET /api/quality/dashboard — aggregate quality/risk analytics for the admin
 * Quality tab: risk distribution + avg score, top open failure modes, repair
 * rollup (counts + cost), and the highest-risk units worklist.
 *
 * All read-only aggregates; the high-risk list rides the
 * (risk_level, quality_score) index on unit_quality_scores.
 */
export const GET = withAuth(async () => {
  try {
    const [risk, failures, repairs, highRisk] = await Promise.all([
      pool.query<{ risk_level: string; n: number; avg: number }>(
        `SELECT risk_level, COUNT(*)::int AS n, ROUND(AVG(quality_score))::int AS avg
           FROM unit_quality_scores GROUP BY risk_level`,
      ),
      pool.query(
        `SELECT fm.id, fm.code, fm.label, fm.severity, COUNT(*)::int AS open_count
           FROM unit_failure_tags t
           JOIN failure_modes fm ON fm.id = t.failure_mode_id
          WHERE t.resolution_status = 'open'
          GROUP BY fm.id, fm.code, fm.label, fm.severity
          ORDER BY open_count DESC, fm.label
          LIMIT 12`,
      ),
      pool.query<{ status: string; n: number; cost: string }>(
        `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(cost_cents), 0)::text AS cost
           FROM unit_repairs GROUP BY status`,
      ),
      pool.query(
        `SELECT q.serial_unit_id, su.serial_number, su.sku, su.unit_uid,
                q.quality_score, q.risk_level, q.risk_reasons, q.grade_at_score::text AS grade
           FROM unit_quality_scores q
           JOIN serial_units su ON su.id = q.serial_unit_id
          WHERE q.risk_level = 'high'
          ORDER BY q.quality_score ASC, q.computed_at DESC
          LIMIT 25`,
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
