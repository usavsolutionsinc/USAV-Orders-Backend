/**
 * Session-collapse GROUNDWORK — switch the active org/staff context of an
 * existing session IN PLACE, without minting a new session.
 *
 * ⚠️ CURRENTLY UNUSED / NOT WIRED. The live org-switch path
 * (`/api/auth/switch-org`) still MINTS A NEW SESSION pointed at the target
 * org's staff profile. This helper is the additive, build-ready alternative for
 * the eventual "switch without re-auth" cutover — it updates the
 * `staff_sessions.active_org_id` / `active_staff_id` pointers added by
 * 2026-06-29_sessions_active_context_columns.sql.
 *
 * The full cutover (re-pointing server-session.ts + every consumer to READ
 * active_org_id/active_staff_id and dropping the re-mint) is built-ready but
 * REQUIRES run-the-app auth-flow verification (sign-in / PIN / passkey /
 * switch) before it replaces the live path. Do NOT call this from the live
 * auth flow until then.
 *
 * Deps-injected so it unit-tests with zero DB. See src/lib/identity/sessions.test.ts.
 *
 * See docs/identity-layer-plan.md.
 */

import type { Pool, PoolClient } from 'pg';
import pool from '@/lib/db';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

type Executor = Pool | PoolClient;

export interface SwitchActiveContextTarget {
  orgId: OrgId;
  staffId: number;
}

export interface SwitchActiveContextResult {
  /** True when an active, non-revoked session row was re-pointed. */
  updated: boolean;
}

/**
 * Collaborators for {@link switchActiveContext}. Defaults hit the live pool
 * inside a single `withTenantTransaction`; unit tests pass fakes.
 */
export interface SwitchActiveContextDeps {
  /** Update the active-context pointers on a live (non-revoked) session.
   *  Returns the number of rows affected (0 = no such active session). */
  updatePointers(
    sessionId: string,
    orgId: OrgId,
    staffId: number,
    db: Executor,
  ): Promise<number>;
  transaction<T>(orgId: OrgId, fn: (db: Executor) => Promise<T>): Promise<T>;
}

const defaultSwitchActiveContextDeps: SwitchActiveContextDeps = {
  async updatePointers(sessionId, orgId, staffId, db) {
    const r = await db.query(
      `UPDATE staff_sessions
          SET active_org_id = $2, active_staff_id = $3
        WHERE sid = $1 AND revoked_at IS NULL`,
      [sessionId, orgId, staffId],
    );
    return r.rowCount ?? 0;
  },
  transaction(orgId, fn) {
    return withTenantTransaction(orgId, (client) => fn(client));
  },
};

/**
 * Re-point a session's active org/staff context in place (no re-mint).
 *
 * GROUNDWORK ONLY — not yet wired into the live switch flow (which still mints a
 * fresh session). Safe to call ad hoc; harmless until a future cutover makes
 * server-session.ts read these pointers.
 */
export async function switchActiveContext(
  sessionId: string,
  target: SwitchActiveContextTarget,
  deps: SwitchActiveContextDeps = defaultSwitchActiveContextDeps,
): Promise<SwitchActiveContextResult> {
  const affected = await deps.transaction(target.orgId, (db) =>
    deps.updatePointers(sessionId, target.orgId, target.staffId, db),
  );
  return { updated: affected > 0 };
}
