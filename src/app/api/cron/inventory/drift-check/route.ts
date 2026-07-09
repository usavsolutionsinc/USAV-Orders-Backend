import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { forEachActiveOrg } from '@/lib/cron/for-each-org';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/inventory/drift-check  (Vercel cron, daily 11:00)
 *
 * Surfaces SKUs where sku_stock disagrees with SUM(sku_stock_ledger.delta) —
 * the canary that a writer bypassed the ledger. Opens DRIFT stock_alerts
 * (idempotent via idx_stock_alerts_open) and resolves cleared ones.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('inventory.drift_check', () =>
      withCronRun('inventory.drift_check', runDriftCheck),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    return NextResponse.json({ success: true, ...summary });
  } catch (err: any) {
    console.error('[cron/inventory/drift-check] error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Drift check failed' }, { status: 500 });
  }
}

async function runDriftCheck() {
  const startedAt = Date.now();

  // Fan out per active org: each pass runs inside that org's tenant connection
  // (GUC set). v_sku_stock_drift is org-scoped on (organization_id, sku).
  const perOrg = await forEachActiveOrg((orgId, client) =>
    runDriftCheckForOrg(orgId, client),
  );

  let opened = 0;
  let resolved = 0;
  const worst: { sku: string; warehouse_drift: number; boxed_drift: number }[] = [];
  for (const r of perOrg) {
    if (!r.ok || !r.result) continue;
    opened += r.result.opened;
    resolved += r.result.resolved;
    worst.push(...r.result.worst);
  }
  worst.sort(
    (a, b) =>
      Math.abs(b.warehouse_drift) + Math.abs(b.boxed_drift) -
      (Math.abs(a.warehouse_drift) + Math.abs(a.boxed_drift)),
  );

  return {
    opened,
    resolved,
    worst: worst.slice(0, 5),
    orgs_swept: perOrg.length,
    orgs_failed: perOrg.filter((r) => !r.ok).length,
    elapsed_ms: Date.now() - startedAt,
  };
}

interface OrgDriftSummary {
  opened: number;
  resolved: number;
  worst: { sku: string; warehouse_drift: number; boxed_drift: number }[];
}

async function runDriftCheckForOrg(orgId: OrgId, c: PoolClient): Promise<OrgDriftSummary> {
  // No BEGIN/COMMIT here — forEachActiveOrg wraps each org pass in a transaction
  // (with the org GUC set via SET LOCAL).

  const opened = await c.query<{ inserted: number }>(
    `WITH ins AS (
       INSERT INTO stock_alerts (sku, bin_id, alert_type, qty_at_trigger, notes, organization_id)
       SELECT
         d.sku,
         NULL::int,
         'DRIFT',
         GREATEST(ABS(d.warehouse_drift), ABS(d.boxed_drift)),
         format(
           'drift: warehouse stored=%s ledger=%s (Δ=%s) ; boxed stored=%s ledger=%s (Δ=%s)',
           d.stored_stock, d.ledger_warehouse, d.warehouse_drift,
           d.stored_boxed, d.ledger_boxed, d.boxed_drift
         ),
         $1
       FROM v_sku_stock_drift d
       WHERE d.organization_id = $1
       ON CONFLICT DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [orgId],
  );

  const resolved = await c.query<{ resolved: number }>(
    `WITH closed AS (
       UPDATE stock_alerts sa
          SET resolved_at = NOW()
        WHERE sa.alert_type = 'DRIFT'
          AND sa.resolved_at IS NULL
          AND sa.organization_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM v_sku_stock_drift d
            WHERE d.organization_id = $1 AND d.sku = sa.sku
          )
       RETURNING 1
     )
     SELECT COUNT(*)::int AS resolved FROM closed`,
    [orgId],
  );

  const worst = await c.query<{ sku: string; warehouse_drift: number; boxed_drift: number }>(
    `SELECT d.sku, d.warehouse_drift, d.boxed_drift
       FROM v_sku_stock_drift d
       WHERE d.organization_id = $1
      ORDER BY ABS(d.warehouse_drift) + ABS(d.boxed_drift) DESC
      LIMIT 5`,
    [orgId],
  );

  return {
    opened: opened.rows[0]?.inserted ?? 0,
    resolved: resolved.rows[0]?.resolved ?? 0,
    worst: worst.rows,
  };
}
