import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';

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
    const summary = await withCronRun('inventory.drift_check', runDriftCheck);
    return NextResponse.json({ success: true, ...summary });
  } catch (err: any) {
    console.error('[cron/inventory/drift-check] error:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Drift check failed' }, { status: 500 });
  }
}

async function runDriftCheck() {
  const startedAt = Date.now();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const opened = await c.query<{ inserted: number }>(
      `WITH ins AS (
         INSERT INTO stock_alerts (sku, bin_id, alert_type, qty_at_trigger, notes)
         SELECT
           d.sku,
           NULL::int,
           'DRIFT',
           GREATEST(ABS(d.warehouse_drift), ABS(d.boxed_drift)),
           format(
             'drift: warehouse stored=%s ledger=%s (Δ=%s) ; boxed stored=%s ledger=%s (Δ=%s)',
             d.stored_stock, d.ledger_warehouse, d.warehouse_drift,
             d.stored_boxed, d.ledger_boxed, d.boxed_drift
           )
         FROM v_sku_stock_drift d
         ON CONFLICT DO NOTHING
         RETURNING 1
       )
       SELECT COUNT(*)::int AS inserted FROM ins`,
    );

    const resolved = await c.query<{ resolved: number }>(
      `WITH closed AS (
         UPDATE stock_alerts sa
            SET resolved_at = NOW()
          WHERE sa.alert_type = 'DRIFT'
            AND sa.resolved_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM v_sku_stock_drift d WHERE d.sku = sa.sku
            )
         RETURNING 1
       )
       SELECT COUNT(*)::int AS resolved FROM closed`,
    );

    const worst = await c.query<{ sku: string; warehouse_drift: number; boxed_drift: number }>(
      `SELECT sku, warehouse_drift, boxed_drift
         FROM v_sku_stock_drift
        ORDER BY ABS(warehouse_drift) + ABS(boxed_drift) DESC
        LIMIT 5`,
    );

    await c.query('COMMIT');
    return {
      opened: opened.rows[0]?.inserted ?? 0,
      resolved: resolved.rows[0]?.resolved ?? 0,
      worst: worst.rows,
      elapsed_ms: Date.now() - startedAt,
    };
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}
