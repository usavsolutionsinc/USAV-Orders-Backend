/**
 * Step-up grants. A session can hold one grant per scope, each with a short
 * expiry. Granted by fresh PIN re-entry, passkey, or phone approval.
 */

import pool from '@/lib/db';

const DEFAULT_STEPUP_MS = 5 * 60 * 1000;

export type StepUpMethod = 'pin' | 'passkey' | 'phone';

export async function grantStepUp(
  sid: string,
  scope: string,
  method: StepUpMethod,
  ttlMs: number = DEFAULT_STEPUP_MS,
): Promise<void> {
  await pool.query(
    `INSERT INTO staff_stepups (sid, scope, granted_at, expires_at, method)
       VALUES ($1, $2, NOW(), NOW() + ($3 || ' milliseconds')::INTERVAL, $4)
     ON CONFLICT (sid, scope)
     DO UPDATE SET granted_at = NOW(),
                   expires_at = NOW() + ($3 || ' milliseconds')::INTERVAL,
                   method = EXCLUDED.method`,
    [sid, scope, String(ttlMs), method],
  );
}

export async function hasStepUp(sid: string, scope: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT COUNT(*)::TEXT AS count
       FROM staff_stepups
      WHERE sid = $1 AND scope = $2 AND expires_at > NOW()`,
    [sid, scope],
  );
  const row = r.rows[0] as { count: string } | undefined;
  return Number(row?.count || 0) > 0;
}

export async function clearStepUp(sid: string, scope?: string): Promise<void> {
  if (scope) {
    await pool.query(`DELETE FROM staff_stepups WHERE sid = $1 AND scope = $2`, [sid, scope]);
  } else {
    await pool.query(`DELETE FROM staff_stepups WHERE sid = $1`, [sid]);
  }
}
