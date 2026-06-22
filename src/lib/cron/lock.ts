/**
 * Distributed cron lock (Wave 4).
 *
 * Prevents two invocations of the same job from running concurrently — Vercel
 * cron retries, an overlapping next tick on a slow run, and manual triggers can
 * all collide. We use a Postgres SESSION-level advisory lock (the same primitive
 * zoho-receiving-sync uses for per-PO serialization), which needs no extra
 * infrastructure (no Redis/Redlock) and is automatically released if the
 * connection dies — so a crashed run can't wedge the lock forever.
 *
 * The lock is GLOBAL (not tenant-scoped) on purpose: it guards the whole job
 * across all tenants, so it runs on the privileged owner pool, never the tenant
 * pool. A skipped invocation returns `{ ran: false }` — callers should report it,
 * not treat it as a failure.
 */
import pool from '@/lib/db';

export interface CronLockResult<T> {
  /** False when another invocation already held the lock (this run was skipped). */
  ran: boolean;
  result?: T;
}

/**
 * Run `fn` while holding the named advisory lock. If the lock is already held
 * by another invocation, skip (`ran: false`) instead of waiting — overlapping
 * cron work is wasteful, not something to queue behind.
 */
export async function withCronLock<T>(
  jobName: string,
  fn: () => Promise<T>,
): Promise<CronLockResult<T>> {
  // One dedicated client for the whole critical section: session-level advisory
  // locks are per-connection, so lock + work + unlock must share it.
  const client = await pool.connect();
  try {
    const lockRes = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [jobName],
    );
    if (!lockRes.rows[0]?.locked) {
      console.warn(`[cron-lock] "${jobName}" is already running; skipping this invocation.`);
      return { ran: false };
    }
    try {
      const result = await fn();
      return { ran: true, result };
    } finally {
      // Best-effort explicit unlock; the lock also auto-releases on disconnect.
      await client
        .query(`SELECT pg_advisory_unlock(hashtext($1))`, [jobName])
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}
