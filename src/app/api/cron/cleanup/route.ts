import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runIdempotencyCleanup } from '@/lib/jobs/idempotency-cleanup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CRON_RUNS_RETENTION_DAYS = 30;
// Processed search-outbox rows are audit-light history; 7 days is plenty
// (pending rows are never touched — only processed_at IS NOT NULL ages out).
const SEARCH_OUTBOX_RETENTION_DAYS = 7;

/**
 * GET /api/cron/cleanup  (Vercel cron, daily)
 *
 * Housekeeping: prune the api_idempotency_responses cache and the cron_runs
 * history (keep ~30 days). Replaces the orphaned /api/qstash/cleanup/idempotency.
 *
 * Tenancy: intentionally GLOBAL / cross-org. cron_runs and
 * api_idempotency_responses are system tables with no tenant scope, so this runs
 * once on the privileged owner pool — never a per-org sweep (Phase D category B).
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('cleanup', () =>
      withCronRun('cleanup', async () => {
        const idempotency = await runIdempotencyCleanup();
        const runs = await pool.query(
          `DELETE FROM cron_runs WHERE started_at < NOW() - ($1::int * INTERVAL '1 day')`,
          [CRON_RUNS_RETENTION_DAYS],
        );
        // entity_search_outbox retention (AI search freshness queue) — guard
        // with to_regclass so this cron keeps working before migration
        // 2026-07-03d is applied.
        let outboxDeleted = 0;
        try {
          const outbox = await pool.query(
            `DELETE FROM entity_search_outbox
             WHERE processed_at IS NOT NULL
               AND processed_at < NOW() - ($1::int * INTERVAL '1 day')`,
            [SEARCH_OUTBOX_RETENTION_DAYS],
          );
          outboxDeleted = outbox.rowCount ?? 0;
        } catch (err: any) {
          if (err?.code !== '42P01') throw err; // undefined_table → migration not applied yet
        }
        // AI margin billing: push unreported usage to the Stripe meter
        // (no-op until STRIPE_AI_METER_EVENT_NAME is configured). Non-fatal —
        // a Stripe hiccup must not fail housekeeping; rows stay unreported
        // and the next run retries.
        let aiMeter: { rowsProcessed: number; orgsReported: number; centsReported: number } | null = null;
        try {
          const { reportAiUsageToStripe } = await import('@/lib/billing/ai-meter-reporter');
          const r = await reportAiUsageToStripe();
          if (r.configured) {
            aiMeter = {
              rowsProcessed: r.rowsProcessed,
              orgsReported: r.orgsReported,
              centsReported: r.centsReported,
            };
          }
        } catch (err) {
          console.warn('[cron.cleanup] AI meter report failed (non-fatal):', err);
        }
        return {
          idempotency_deleted: idempotency.deletedRows,
          cron_runs_deleted: runs.rowCount ?? 0,
          search_outbox_deleted: outboxDeleted,
          ...(aiMeter ? { ai_meter: aiMeter } : {}),
        };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const summary = locked.result!;
    console.log('[cron.cleanup]', summary);
    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('[cron/cleanup]', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
