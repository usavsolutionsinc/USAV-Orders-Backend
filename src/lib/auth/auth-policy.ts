/**
 * Per-staff sign-in policy (WS6.1).
 *
 * Reads the `staff.auth_method` knob added by
 * `src/lib/migrations/2026-06-28_staff_auth_policy.sql`. Kept tiny and
 * standalone so the (hot) sign-in handler only needs a one-line import.
 *
 * FAIL-SAFE: if the column is not present yet (migration not applied), this
 * resolves to 'pin' — the historical default — so every existing sign-in path
 * is byte-identical until the migration lands.
 */

import pool from '@/lib/db';

export type StaffAuthMethod = 'pin' | 'password';

/**
 * Resolve a staff member's sign-in method. Defaults to 'pin' on any error
 * (missing column / missing row) so behavior is unchanged pre-migration.
 */
export async function getStaffAuthMethod(staffId: number): Promise<StaffAuthMethod> {
  try {
    const r = await pool.query<{ auth_method: string | null }>(
      `SELECT auth_method FROM staff WHERE id = $1 LIMIT 1`,
      [staffId],
    );
    const v = (r.rows[0]?.auth_method ?? 'pin').toLowerCase();
    return v === 'password' ? 'password' : 'pin';
  } catch {
    return 'pin';
  }
}
