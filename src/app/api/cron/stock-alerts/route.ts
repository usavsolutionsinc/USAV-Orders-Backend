import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { forEachActiveOrg } from '@/lib/cron/for-each-org';
import type { OrgId } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STALE_DAYS = Number(process.env.STOCK_ALERT_STALE_DAYS || 60);

/**
 * GET /api/cron/stock-alerts  (Vercel cron, daily)
 *
 * Scans bin_contents and:
 *   • Opens new alerts where conditions are met (LOW_STOCK, NEVER_COUNTED,
 *     STALE_COUNT).
 *   • Resolves open alerts whose underlying condition cleared.
 *
 * Idempotent — the UNIQUE-on-open constraint dedupes new inserts; resolutions
 * just stamp resolved_at on still-open rows that no longer match.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('stock_alerts', () =>
      withCronRun('stock_alerts', runStockAlerts),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron failed';
    console.error('[GET /api/cron/stock-alerts] error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function runStockAlerts() {
  const startedAt = Date.now();

  // Fan out per active org: each pass runs inside that org's tenant connection
  // (GUC set), so once RLS is FORCE-enforced a sweep only sees that org's rows.
  // Per-org failures are isolated by forEachActiveOrg.
  const perOrg = await forEachActiveOrg((orgId, client) =>
    runStockAlertsForOrg(orgId, client),
  );

  // Aggregate per-org totals into the same summary shape callers expect.
  const totals = {
    opened: { low_stock: 0, never_counted: 0, stale_count: 0 },
    resolved: 0,
  };
  for (const r of perOrg) {
    if (!r.ok || !r.result) continue;
    totals.opened.low_stock += r.result.opened.low_stock;
    totals.opened.never_counted += r.result.opened.never_counted;
    totals.opened.stale_count += r.result.opened.stale_count;
    totals.resolved += r.result.resolved;
  }

  return {
    ...totals,
    orgs_swept: perOrg.length,
    orgs_failed: perOrg.filter((r) => !r.ok).length,
    elapsed_ms: Date.now() - startedAt,
  };
}

interface OrgStockAlertSummary {
  opened: { low_stock: number; never_counted: number; stale_count: number };
  resolved: number;
}

async function runStockAlertsForOrg(
  orgId: OrgId,
  c: PoolClient,
): Promise<OrgStockAlertSummary> {
  // No BEGIN/COMMIT here — forEachActiveOrg wraps each org pass in a transaction
  // (with the org GUC set via SET LOCAL).

  // ─── 1. Open new LOW_STOCK alerts ─────────────────────────────────────
  const lowOpened = await c.query<{ inserted: number }>(
    `WITH ins AS (
       INSERT INTO stock_alerts (sku, bin_id, alert_type, threshold, qty_at_trigger, organization_id)
       SELECT bc.sku, bc.location_id, 'LOW_STOCK', bc.min_qty, bc.qty, bc.organization_id
       FROM bin_contents bc
       WHERE bc.min_qty IS NOT NULL AND bc.qty <= bc.min_qty
         AND bc.organization_id = $1
       ON CONFLICT DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [orgId],
  );

  // ─── 2. Open NEVER_COUNTED alerts ─────────────────────────────────────
  const neverOpened = await c.query<{ inserted: number }>(
    `WITH ins AS (
       INSERT INTO stock_alerts (sku, bin_id, alert_type, qty_at_trigger, organization_id)
       SELECT bc.sku, bc.location_id, 'NEVER_COUNTED', bc.qty, bc.organization_id
       FROM bin_contents bc
       WHERE bc.last_counted IS NULL AND bc.qty > 0
         AND bc.organization_id = $1
       ON CONFLICT DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [orgId],
  );

  // ─── 3. Open STALE_COUNT alerts ───────────────────────────────────────
  const staleOpened = await c.query<{ inserted: number }>(
    `WITH ins AS (
       INSERT INTO stock_alerts (sku, bin_id, alert_type, threshold, qty_at_trigger, organization_id)
       SELECT bc.sku, bc.location_id, 'STALE_COUNT', $1::int, bc.qty, bc.organization_id
       FROM bin_contents bc
       WHERE bc.last_counted IS NOT NULL
         AND bc.last_counted < NOW() - ($1::int * INTERVAL '1 day')
         AND bc.qty > 0
         AND bc.organization_id = $2
       ON CONFLICT DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM ins`,
    [STALE_DAYS, orgId],
  );

  // ─── 4. Resolve alerts that no longer match ───────────────────────────
  const resolved = await c.query<{ resolved: number }>(
    `WITH closed AS (
       UPDATE stock_alerts sa
       SET resolved_at = NOW()
       WHERE sa.resolved_at IS NULL
         AND sa.organization_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM bin_contents bc
           WHERE bc.location_id = sa.bin_id AND bc.sku = sa.sku
             AND bc.organization_id = sa.organization_id
             AND (
               (sa.alert_type = 'LOW_STOCK'     AND bc.min_qty IS NOT NULL AND bc.qty <= bc.min_qty)
              OR (sa.alert_type = 'NEVER_COUNTED' AND bc.last_counted IS NULL AND bc.qty > 0)
              OR (sa.alert_type = 'STALE_COUNT' AND bc.last_counted < NOW() - ($1::int * INTERVAL '1 day') AND bc.qty > 0)
             )
         )
       RETURNING 1
     )
     SELECT COUNT(*)::int AS resolved FROM closed`,
    [STALE_DAYS, orgId],
  );

  return {
    opened: {
      low_stock: lowOpened.rows[0]?.inserted ?? 0,
      never_counted: neverOpened.rows[0]?.inserted ?? 0,
      stale_count: staleOpened.rows[0]?.inserted ?? 0,
    },
    resolved: resolved.rows[0]?.resolved ?? 0,
  };
}
