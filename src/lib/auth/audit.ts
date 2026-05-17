/**
 * Single writer for `auth_audit`. Every auth-relevant action goes through
 * here so we have one place to grep when a security question comes up.
 *
 * Events are kebab-case, namespaced: `signin.pin`, `signin.passkey`,
 * `signout`, `pin.set`, `stepup.granted`, `permission.denied`,
 * `enrollment.consumed`, `role.changed`, etc.
 */

import pool from '@/lib/db';

export type AuthAuditResult = 'ok' | 'denied' | 'error';

export interface AuditOpts {
  staffId?: number | null;
  event: string;
  result: AuthAuditResult;
  ip?: string | null;
  userAgent?: string | null;
  sid?: string | null;
  detail?: Record<string, unknown>;
}

export async function audit(opts: AuditOpts): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth_audit (staff_id, event, result, ip, user_agent, sid, detail)
       VALUES ($1, $2, $3, $4::inet, $5, $6, $7::jsonb)`,
      [
        opts.staffId ?? null,
        opts.event,
        opts.result,
        opts.ip ?? null,
        opts.userAgent ?? null,
        opts.sid ?? null,
        JSON.stringify(opts.detail ?? {}),
      ],
    );
  } catch (err) {
    // Audit must never break the request. Log + drop.
    console.warn('[auth_audit] write failed:', err instanceof Error ? err.message : err);
  }
}
