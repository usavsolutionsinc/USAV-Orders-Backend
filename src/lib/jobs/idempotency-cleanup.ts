import pool from '@/lib/db';

export interface IdempotencyCleanupResult {
  ok: boolean;
  deletedRows: number;
  durationMs: number;
}

/**
 * Deletes api_idempotency_responses older than 7 days.
 * Keeps the table small — rows are only useful for short-lived retry windows.
 */
export async function runIdempotencyCleanup(): Promise<IdempotencyCleanupResult> {
  const start = Date.now();

  const result = await pool.query(
    `DELETE FROM api_idempotency_responses WHERE created_at < NOW() - INTERVAL '7 days'`,
  );

  return {
    ok: true,
    deletedRows: result.rowCount ?? 0,
    durationMs: Date.now() - start,
  };
}
