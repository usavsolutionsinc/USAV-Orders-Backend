/**
 * Sensitive-information wall (WS6.1).
 *
 * A reusable server guard that, for a staff member flagged
 * `staff.requires_sensitive_stepup = true`, requires a *fresh* step-up grant
 * before a guarded sensitive surface runs. It REUSES the existing step-up
 * machinery — the grant is minted by `POST /api/auth/step-up` and stored in
 * `staff_stepups` with its own TTL (`src/lib/auth/stepup.ts`); this guard only
 * checks for a live grant in the sensitive scope. It does NOT introduce a
 * second/parallel auth system.
 *
 * Usage (inside a `withAuth` handler — add at the very top):
 *
 *   const block = await requireSensitiveStepUp(ctx);
 *   if (block) return block;            // 403 STEP_UP_REQUIRED
 *
 * The client should respond to STEP_UP_REQUIRED exactly as it does to the
 * wrapper's STEPUP_REQUIRED: open the step-up prompt (StepUpModal), POST
 * `/api/auth/step-up` with `{ scope: 'sensitive', method: 'pin' | 'passkey' }`,
 * then retry the original request.
 *
 * FAIL-SAFE: if the `requires_sensitive_stepup` column is not present yet
 * (migration not applied) the flag reads as `false`, so the guard is a no-op
 * and existing behavior is fully preserved.
 *
 * Deliberately NOT bolted onto every route. Apply it to clearly-sensitive
 * surfaces only — e.g. staff/role management mutations, payroll / billing
 * settings, org export, integration-credential changes. The reference wiring
 * lives in `src/app/api/admin/staff/update/route.ts`.
 *
 * NOTE: unlike `withAuth`'s destructive step-up (which exempts admins), this
 * wall is an *explicit per-staff opt-in* set by the owner. It is intentionally
 * NOT admin-exempt — the whole point is that an owner can force even an admin
 * to re-auth before sensitive surfaces.
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { hasStepUp } from './stepup';
import type { AuthContext } from './auth-context';

/** Canonical scope name for the sensitive-information wall step-up grant. */
export const SENSITIVE_STEPUP_SCOPE = 'sensitive';

/**
 * Whether this staff member is subject to the sensitive wall. Returns false on
 * any error (missing column / row) so behavior is unchanged pre-migration.
 */
export async function staffRequiresSensitiveStepUp(staffId: number): Promise<boolean> {
  try {
    const r = await pool.query<{ requires: boolean }>(
      `SELECT COALESCE(requires_sensitive_stepup, false) AS requires
         FROM staff WHERE id = $1 LIMIT 1`,
      [staffId],
    );
    return r.rows[0]?.requires === true;
  } catch {
    return false;
  }
}

/**
 * Guard for a sensitive route. Returns a 403 `STEP_UP_REQUIRED` response when
 * the caller is walled and lacks a live step-up grant in `scope`; otherwise
 * returns `null` (proceed).
 */
export async function requireSensitiveStepUp(
  ctx: AuthContext,
  scope: string = SENSITIVE_STEPUP_SCOPE,
): Promise<NextResponse | null> {
  const required = await staffRequiresSensitiveStepUp(ctx.staffId);
  if (!required) return null;

  const granted = await hasStepUp(ctx.session.sid, scope);
  if (granted) return null;

  return NextResponse.json(
    { error: 'STEP_UP_REQUIRED', scope, method_hint: 'pin' },
    { status: 403 },
  );
}
