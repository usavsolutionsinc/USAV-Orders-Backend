/**
 * Shift-aware sign-in helpers. Sign-in == clock-in: a successful PIN/passkey
 * authentication opens a `time_punches` row tied to the staff's currently
 * active shift. Sign-out closes the row.
 *
 *   • findActiveShift(staffId)   — returns the shift the staff should be
 *                                  signing in to right now (or null).
 *   • clockIn(...)               — inserts an open time_punches row.
 *   • clockOut(staffId)          — closes the open punch, auto-deducting
 *                                  the default lunch break if the punch
 *                                  spanned the shop's lunch window.
 *
 * Materializes shifts on demand so a staff who comes in early (or whose
 * template was just edited) can still sign in without a cron pre-build.
 */

import pool from '@/lib/db';
import type { PoolClient } from 'pg';

export interface ActiveShift {
  id: number;
  staff_id: number;
  starts_at: Date;
  ends_at: Date;
  status: string;
}

interface PayrollSettings {
  default_break_minutes: number;
  default_lunch_start_minute: number;
  default_lunch_end_minute: number;
  timezone: string;
}

/**
 * Returns the staff's currently-active shift (one whose window covers
 * NOW() and is not cancelled/missed). If no concrete shift exists yet
 * for today, attempts to materialize one from the staff's templates —
 * this is the no-cron pre-build for someone arriving exactly at 9:00.
 */
export async function findActiveShift(staffId: number, client?: PoolClient): Promise<ActiveShift | null> {
  const db = client ?? pool;

  // Cheap first pass: maybe a shift row already exists.
  const fast = await db.query<ActiveShift>(
    `SELECT id, staff_id, starts_at, ends_at, status
       FROM shifts
      WHERE staff_id = $1
        AND starts_at <= NOW()
        AND ends_at   >= NOW()
        AND status NOT IN ('cancelled', 'missed')
      ORDER BY ends_at DESC
      LIMIT 1`,
    [staffId],
  );
  if (fast.rows[0]) return fast.rows[0];

  // Nothing materialized — try once. materialize_shifts is idempotent so
  // the worst case is a no-op.
  await db.query(`SELECT materialize_shifts($1::int, CURRENT_DATE, CURRENT_DATE)`, [staffId]);

  const slow = await db.query<ActiveShift>(
    `SELECT id, staff_id, starts_at, ends_at, status
       FROM shifts
      WHERE staff_id = $1
        AND starts_at <= NOW()
        AND ends_at   >= NOW()
        AND status NOT IN ('cancelled', 'missed')
      ORDER BY ends_at DESC
      LIMIT 1`,
    [staffId],
  );
  return slow.rows[0] ?? null;
}

/**
 * Opens a time_punches row tied to a session and a shift. Idempotent —
 * if the staff somehow already has an open punch, we leave the existing
 * one alone (the unique-index `idx_time_punches_one_open` enforces this
 * at the DB layer too).
 */
export async function clockIn(
  staffId: number,
  /** Null when the staff is signing in off-schedule — the punch still
   *  records but isn't tied to a planned shift. */
  shiftId: number | null,
  source: 'pin' | 'passkey' | 'badge' = 'pin',
  client?: PoolClient,
): Promise<{ id: number } | null> {
  const db = client ?? pool;
  // Already clocked-in? Return the existing punch so the caller stays idempotent.
  const open = await db.query<{ id: number }>(
    `SELECT id FROM time_punches WHERE staff_id = $1 AND punched_out_at IS NULL`,
    [staffId],
  );
  if (open.rows[0]) return open.rows[0];

  try {
    const r = await db.query<{ id: number }>(
      `INSERT INTO time_punches (staff_id, shift_id, punched_in_at, source)
       VALUES ($1, $2, NOW(), $3)
       RETURNING id`,
      [staffId, shiftId, source],
    );
    return r.rows[0] ?? null;
  } catch (err) {
    // Unique partial index on (staff_id) WHERE punched_out_at IS NULL —
    // race with a parallel sign-in. Swallow and return the winner's row.
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      const recheck = await db.query<{ id: number }>(
        `SELECT id FROM time_punches WHERE staff_id = $1 AND punched_out_at IS NULL`,
        [staffId],
      );
      return recheck.rows[0] ?? null;
    }
    throw err;
  }
}

async function getPayrollSettings(client?: PoolClient): Promise<PayrollSettings | null> {
  const db = client ?? pool;
  try {
    const r = await db.query<PayrollSettings>(
      `SELECT default_break_minutes, default_lunch_start_minute, default_lunch_end_minute, timezone
         FROM payroll_settings
        WHERE id = 1`,
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  }
}

function punchSpannedLunch(
  punchedInAt: Date,
  punchedOutAt: Date,
  settings: PayrollSettings,
): boolean {
  // Cheap check: does the punch window cover at least one minute of the
  // configured lunch (in the shop's local timezone)? Falls back to
  // "yes" when timezone lookups fail so we don't accidentally cheat
  // staff out of a break.
  try {
    const localStart = new Date(
      punchedInAt.toLocaleString('en-US', { timeZone: settings.timezone }),
    );
    const localEnd = new Date(
      punchedOutAt.toLocaleString('en-US', { timeZone: settings.timezone }),
    );
    const startMinute = localStart.getHours() * 60 + localStart.getMinutes();
    const endMinute = localEnd.getHours() * 60 + localEnd.getMinutes();
    return startMinute <= settings.default_lunch_end_minute &&
           endMinute >= settings.default_lunch_start_minute;
  } catch {
    return true;
  }
}

/**
 * Closes the staff's open time_punches row (if any) and auto-deducts the
 * default break if the punch window covered the shop's lunch.
 */
export async function clockOut(staffId: number, client?: PoolClient): Promise<{ id: number; breakMinutes: number } | null> {
  const db = client ?? pool;

  const open = await db.query<{ id: number; punched_in_at: Date }>(
    `SELECT id, punched_in_at FROM time_punches
      WHERE staff_id = $1 AND punched_out_at IS NULL
      ORDER BY punched_in_at DESC
      LIMIT 1`,
    [staffId],
  );
  const punch = open.rows[0];
  if (!punch) return null;

  const settings = await getPayrollSettings(client);
  const now = new Date();
  let breakMinutes = 0;
  if (settings && settings.default_break_minutes > 0 && punchSpannedLunch(punch.punched_in_at, now, settings)) {
    breakMinutes = settings.default_break_minutes;
  }

  await db.query(
    `UPDATE time_punches
        SET punched_out_at = NOW(),
            break_minutes  = $2,
            updated_at     = NOW()
      WHERE id = $1`,
    [punch.id, breakMinutes],
  );

  return { id: punch.id, breakMinutes };
}
