import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

const STALE_DAYS = Number(process.env.STOCK_ALERT_STALE_DAYS || 60);

/**
 * GET /api/cron/stock-alerts
 *
 * Scans bin_contents and:
 *   • Opens new alerts where conditions are met (LOW_STOCK, NEVER_COUNTED,
 *     STALE_COUNT).
 *   • Resolves open alerts whose underlying condition cleared.
 *
 * Idempotent — the UNIQUE-on-open constraint dedupes new inserts; resolutions
 * just stamp resolved_at on still-open rows that no longer match.
 *
 * Scheduled via vercel.json cron (e.g. daily at 14:00 UTC).
 */
export async function GET(_req: NextRequest) {
  const startedAt = Date.now();
  try {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');

      // ─── 1. Open new LOW_STOCK alerts ─────────────────────────────────────
      const lowOpened = await c.query<{ inserted: number }>(
        `WITH ins AS (
           INSERT INTO stock_alerts (sku, bin_id, alert_type, threshold, qty_at_trigger)
           SELECT bc.sku, bc.location_id, 'LOW_STOCK', bc.min_qty, bc.qty
           FROM bin_contents bc
           WHERE bc.min_qty IS NOT NULL AND bc.qty <= bc.min_qty
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS inserted FROM ins`,
      );

      // ─── 2. Open NEVER_COUNTED alerts ─────────────────────────────────────
      const neverOpened = await c.query<{ inserted: number }>(
        `WITH ins AS (
           INSERT INTO stock_alerts (sku, bin_id, alert_type, qty_at_trigger)
           SELECT bc.sku, bc.location_id, 'NEVER_COUNTED', bc.qty
           FROM bin_contents bc
           WHERE bc.last_counted IS NULL AND bc.qty > 0
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS inserted FROM ins`,
      );

      // ─── 3. Open STALE_COUNT alerts ───────────────────────────────────────
      const staleOpened = await c.query<{ inserted: number }>(
        `WITH ins AS (
           INSERT INTO stock_alerts (sku, bin_id, alert_type, threshold, qty_at_trigger)
           SELECT bc.sku, bc.location_id, 'STALE_COUNT', $1::int, bc.qty
           FROM bin_contents bc
           WHERE bc.last_counted IS NOT NULL
             AND bc.last_counted < NOW() - ($1::int * INTERVAL '1 day')
             AND bc.qty > 0
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::int AS inserted FROM ins`,
        [STALE_DAYS],
      );

      // ─── 4. Resolve alerts that no longer match ───────────────────────────
      const resolved = await c.query<{ resolved: number }>(
        `WITH closed AS (
           UPDATE stock_alerts sa
           SET resolved_at = NOW()
           WHERE sa.resolved_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM bin_contents bc
               WHERE bc.location_id = sa.bin_id AND bc.sku = sa.sku
                 AND (
                   (sa.alert_type = 'LOW_STOCK'     AND bc.min_qty IS NOT NULL AND bc.qty <= bc.min_qty)
                  OR (sa.alert_type = 'NEVER_COUNTED' AND bc.last_counted IS NULL AND bc.qty > 0)
                  OR (sa.alert_type = 'STALE_COUNT' AND bc.last_counted < NOW() - ($1::int * INTERVAL '1 day') AND bc.qty > 0)
                 )
             )
           RETURNING 1
         )
         SELECT COUNT(*)::int AS resolved FROM closed`,
        [STALE_DAYS],
      );

      await c.query('COMMIT');
      return NextResponse.json({
        success: true,
        opened: {
          low_stock: lowOpened.rows[0]?.inserted ?? 0,
          never_counted: neverOpened.rows[0]?.inserted ?? 0,
          stale_count: staleOpened.rows[0]?.inserted ?? 0,
        },
        resolved: resolved.rows[0]?.resolved ?? 0,
        elapsed_ms: Date.now() - startedAt,
      });
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  } catch (err: any) {
    console.error('[GET /api/cron/stock-alerts] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Cron failed' },
      { status: 500 },
    );
  }
}
