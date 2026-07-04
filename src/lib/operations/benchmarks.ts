/**
 * "You vs typical" benchmark comparison (plan §2.5 / Phase 1).
 *
 * Pairs the seeded insight_links benchmarks (global NULL-org rows + any
 * org-specific rows) with the org's OWN actuals computed from its
 * inventory_events spine — org-scoped, never cross-tenant (Monitor rule).
 * Signals/insight tables may be empty pre-apply/pre-backfill; every branch
 * degrades to nulls, never throws past the route's catch.
 *
 * Deps-injected (default tenantQuery) so unit tests run DB-free.
 */

import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface BenchmarkRow {
  linkage_type: string;
  subject_kind: string;
  subject_ref: string | null;
  metrics: Record<string, unknown> | null;
  source: string;
  organization_id: string | null;
}

export interface BenchmarkActuals {
  rangeDays: number;
  /** TEST_FAIL / (TEST_FAIL + TEST_PASS), percent 0–100; null when no tests in range. */
  testFailPct: number | null;
  testEvents: number;
  /** RETURNED / SHIPPED, percent 0–100; null when nothing shipped in range. */
  returnPct: number | null;
  shippedCount: number;
  returnedCount: number;
}

export interface BenchmarkComparison {
  actuals: BenchmarkActuals;
  benchmarks: BenchmarkRow[];
}

export interface BenchmarksDeps {
  query: typeof tenantQuery;
}

const defaultDeps: BenchmarksDeps = { query: tenantQuery };

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export async function getBenchmarkComparison(
  orgId: OrgId,
  rangeDays: number,
  deps: BenchmarksDeps = defaultDeps,
): Promise<BenchmarkComparison> {
  const days = Number.isFinite(rangeDays) ? Math.max(1, Math.min(Math.round(rangeDays), 365)) : 30;

  const counts = await deps.query<{ event_type: string; count: number }>(
    orgId,
    `SELECT event_type, COUNT(*)::int AS count
       FROM inventory_events
      WHERE organization_id = $1
        AND occurred_at >= NOW() - make_interval(days => $2)
        AND event_type IN ('TEST_PASS','TEST_FAIL','SHIPPED','RETURNED')
      GROUP BY event_type`,
    [orgId, days],
  );
  const byType = new Map(counts.rows.map((r) => [r.event_type, Number(r.count)]));
  const pass = byType.get('TEST_PASS') ?? 0;
  const fail = byType.get('TEST_FAIL') ?? 0;
  const shipped = byType.get('SHIPPED') ?? 0;
  const returned = byType.get('RETURNED') ?? 0;

  // Benchmarks degrade to [] pre-apply (table missing) or pre-seed (empty) —
  // a failing sub-resource must never 500 the readout (degrade-not-fail).
  let benchmarks: BenchmarkRow[] = [];
  try {
    const r = await deps.query<BenchmarkRow>(
      orgId,
      `SELECT organization_id, linkage_type, subject_kind, subject_ref, metrics, source
         FROM insight_links
        WHERE (organization_id = $1 OR organization_id IS NULL)
        ORDER BY organization_id NULLS LAST, subject_kind, subject_ref
        LIMIT 50`,
      [orgId],
    );
    benchmarks = r.rows;
  } catch (err) {
    console.warn('[benchmarks] insight_links read failed (degrading to empty):', err);
  }

  return {
    actuals: {
      rangeDays: days,
      testFailPct: pct(fail, pass + fail),
      testEvents: pass + fail,
      returnPct: pct(returned, shipped),
      shippedCount: shipped,
      returnedCount: returned,
    },
    benchmarks,
  };
}
