import pool from '@/lib/db';

/**
 * Wraps a cron/job body so every invocation is persisted to `cron_runs`.
 *
 * - Inserts a `running` row up front.
 * - On success: `status='success'`, `duration_ms`, and the fn's returned object
 *   as the `summary` jsonb (the per-job counts — what it polled/processed).
 * - On throw: `status='failed'` + `error`, then re-throws so the route still
 *   surfaces a 500.
 *
 * Logging failures are swallowed — observability must never break the job.
 * This is the single choke point every cron route funnels through; the matching
 * display registry lives in {@link file://./registry.ts}.
 */
export async function withCronRun<T>(
  job: string,
  fn: () => Promise<T>,
  opts?: { trigger?: 'cron' | 'manual' },
): Promise<T> {
  const trigger = opts?.trigger ?? 'cron';
  const startedAt = Date.now();

  let runId: number | null = null;
  try {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO cron_runs (job, status, trigger, started_at)
       VALUES ($1, 'running', $2, NOW())
       RETURNING id`,
      [job, trigger],
    );
    runId = ins.rows[0]?.id ?? null;
  } catch {
    /* observability must never break the job */
  }

  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    if (runId != null) {
      const summary =
        result && typeof result === 'object' ? JSON.stringify(result) : null;
      await pool
        .query(
          `UPDATE cron_runs
              SET status = 'success', finished_at = NOW(), duration_ms = $2, summary = $3
            WHERE id = $1`,
          [runId, durationMs, summary],
        )
        .catch(() => {});
    }
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    if (runId != null) {
      await pool
        .query(
          `UPDATE cron_runs
              SET status = 'failed', finished_at = NOW(), duration_ms = $2, error = $3
            WHERE id = $1`,
          [runId, durationMs, message.slice(0, 2000)],
        )
        .catch(() => {});
    }
    throw err;
  }
}
