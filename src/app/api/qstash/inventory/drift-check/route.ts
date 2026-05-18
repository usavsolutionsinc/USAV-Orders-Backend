import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isQStashOrigin } from '@/lib/qstash';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/qstash/inventory/drift-check
 *
 * Surfaces SKUs where sku_stock.stock (or .boxed_stock) disagrees with
 * SUM(sku_stock_ledger.delta) per dimension — the canary that a writer
 * bypassed the ledger. v_sku_stock_drift is the source (defined by
 * 2026-04-15_sku_stock_ledger_authoritative.sql).
 *
 * Behavior:
 *   - For every drifted SKU, INSERT a stock_alerts row of alert_type
 *     'DRIFT' (idempotent via idx_stock_alerts_open, the partial unique
 *     index on (sku, COALESCE(bin_id,0), alert_type) WHERE resolved_at
 *     IS NULL).
 *   - When the drift clears (a subsequent ledger row makes the sums
 *     match), the next run stamps resolved_at via the resolve step.
 *
 * The route returns a count + a small sample so QStash logs are useful
 * without flooding when many SKUs drift simultaneously.
 *
 * Triggered by QStash on a daily schedule (see qstash-schedules.json).
 * Auth: isQStashOrigin (signature header or Bearer $QSTASH_TOKEN).
 */
export async function POST(request: NextRequest) {
  if (!isQStashOrigin(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');

      // 1. Open new DRIFT alerts for every currently-drifted SKU.
      //    qty_at_trigger gets the larger absolute drift so a quick
      //    glance at the alerts table sorts by severity.
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

      // 2. Resolve open DRIFT alerts whose SKU is no longer in the
      //    drift view.
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

      // 3. Top-5 worst drifts for the QStash run log.
      const worst = await c.query<{
        sku: string;
        warehouse_drift: number;
        boxed_drift: number;
      }>(
        `SELECT sku, warehouse_drift, boxed_drift
           FROM v_sku_stock_drift
          ORDER BY ABS(warehouse_drift) + ABS(boxed_drift) DESC
          LIMIT 5`,
      );

      await c.query('COMMIT');
      return NextResponse.json({
        success: true,
        opened: opened.rows[0]?.inserted ?? 0,
        resolved: resolved.rows[0]?.resolved ?? 0,
        worst: worst.rows,
        elapsed_ms: Date.now() - startedAt,
      });
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  } catch (err: any) {
    console.error('[POST /api/qstash/inventory/drift-check] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Drift check failed' },
      { status: 500 },
    );
  }
}

/** Health probe — no auth required, no work performed. */
export async function GET() {
  return NextResponse.json({ ok: true, queue: 'qstash', job: 'inventory-drift-check' });
}
