import pool from '@/lib/db';

/**
 * SSO mapping helper. A future middleware (next-auth, Clerk, custom JWT)
 * resolves an identity-provider subject; this helper maps that subject to
 * our internal staff row + stamps last_login_at.
 *
 * Until a provider is chosen, callers can still:
 *   • Pre-seed (sso_provider, sso_subject) on staff rows directly.
 *   • Use `lookupStaffBySso()` from a middleware once configured.
 */

export interface StaffIdentity {
  staffId: number;
  name: string;
  role: string | null;
}

export async function lookupStaffBySso(
  provider: string,
  subject: string,
): Promise<StaffIdentity | null> {
  const p = provider.trim().toLowerCase();
  const s = subject.trim();
  if (!p || !s) return null;
  const r = await pool.query<{ id: number; name: string; role: string | null }>(
    `SELECT id, name, role
     FROM staff
     WHERE sso_provider = $1 AND sso_subject = $2
       AND COALESCE(active, true) = true
     LIMIT 1`,
    [p, s],
  );
  const row = r.rows[0];
  return row
    ? { staffId: row.id, name: row.name, role: row.role }
    : null;
}

/**
 * Record a successful login. Returns the resolved staff row; throws if the
 * subject isn't mapped (the calling middleware should 403 in that case).
 */
export async function recordSsoLogin(
  provider: string,
  subject: string,
): Promise<StaffIdentity> {
  const identity = await lookupStaffBySso(provider, subject);
  if (!identity) {
    throw new Error(`SSO subject ${provider}:${subject} is not mapped to a staff row`);
  }
  await pool
    .query(`UPDATE staff SET last_login_at = NOW() WHERE id = $1`, [identity.staffId])
    .catch(() => {});
  return identity;
}

/**
 * Admin helper — link an existing staff row to an SSO subject.
 * Used by a one-off CLI / admin UI when onboarding a new provider.
 */
export async function linkStaffSso(
  staffId: number,
  provider: string,
  subject: string,
): Promise<void> {
  await pool.query(
    `UPDATE staff
     SET sso_provider = $2, sso_subject = $3
     WHERE id = $1`,
    [staffId, provider.trim().toLowerCase(), subject.trim()],
  );
}
