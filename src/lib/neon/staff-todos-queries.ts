/**
 * Per-staff header to-do list queries (general + recurring).
 *
 * Backs GET/POST/PATCH/DELETE /api/staff-todos, which drives the header goal
 * chip's "Recurring" and "To-do" modes. Every query is scoped by the verified
 * session's staff_id — a staffer can only ever touch their own list.
 *
 * Recurrence: a recurring task carries `recur_interval_ms` + `recur_anchor`
 * and no done flag. Done-this-cycle is derived from the latest
 * staff_todo_completions row falling inside the current cycle; the client
 * recomputes that locally on a timer so rollover needs no polling. Unchecking
 * deletes only the current cycle's completions — prior cycles are history.
 */

import pool from '@/lib/db';

export type StaffTodoKind = 'general' | 'recurring';

export interface StaffTodoRow {
  id: number;
  kind: StaffTodoKind;
  text: string;
  sort_order: number;
  /** recurring only — cycle length in ms. */
  recur_interval_ms: number | null;
  /** recurring only — epoch ms of the current cycle chain's origin. */
  recur_anchor_ms: number | null;
  /** general only — epoch ms when checked (null = open). */
  completed_at_ms: number | null;
  /** recurring only — epoch ms of the latest check-off ever (null = never). */
  last_completed_at_ms: number | null;
}

const HOUR_MS = 60 * 60_000;
export const DEFAULT_RECUR_INTERVAL_MS = 4 * HOUR_MS;

/** Start of the current cycle for a recurring task (epoch ms). */
export function cyclePeriodStartMs(anchorMs: number, intervalMs: number, nowMs: number): number {
  if (intervalMs <= 0 || nowMs <= anchorMs) return anchorMs;
  return anchorMs + Math.floor((nowMs - anchorMs) / intervalMs) * intervalMs;
}

const SELECT_ROW = `
  SELECT t.id::int,
         t.kind,
         t.text,
         t.sort_order,
         t.recur_interval_ms::bigint AS recur_interval_ms,
         (EXTRACT(EPOCH FROM t.recur_anchor) * 1000)::bigint AS recur_anchor_ms,
         (EXTRACT(EPOCH FROM t.completed_at) * 1000)::bigint AS completed_at_ms,
         (SELECT (EXTRACT(EPOCH FROM MAX(c.completed_at)) * 1000)::bigint
            FROM staff_todo_completions c
           WHERE c.todo_id = t.id) AS last_completed_at_ms
    FROM staff_todos t`;

function mapRow(row: Record<string, unknown>): StaffTodoRow {
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    id: Number(row.id),
    kind: row.kind as StaffTodoKind,
    text: String(row.text),
    sort_order: Number(row.sort_order) || 0,
    recur_interval_ms: num(row.recur_interval_ms),
    recur_anchor_ms: num(row.recur_anchor_ms),
    completed_at_ms: num(row.completed_at_ms),
    last_completed_at_ms: num(row.last_completed_at_ms),
  };
}

/** All live (non-archived) todos for one staff + station, list order. */
export async function listStaffTodos(staffId: number, station: string): Promise<StaffTodoRow[]> {
  // Lateral top-1 probe on idx_staff_todo_completions_todo_time instead of
  // SELECT_ROW's correlated subquery — this is the hot path (the header chip
  // fetches it on every page).
  const r = await pool.query(
    `SELECT t.id::int,
            t.kind,
            t.text,
            t.sort_order,
            t.recur_interval_ms::bigint AS recur_interval_ms,
            (EXTRACT(EPOCH FROM t.recur_anchor) * 1000)::bigint AS recur_anchor_ms,
            (EXTRACT(EPOCH FROM t.completed_at) * 1000)::bigint AS completed_at_ms,
            (EXTRACT(EPOCH FROM lc.last_completed_at) * 1000)::bigint AS last_completed_at_ms
       FROM staff_todos t
       LEFT JOIN LATERAL (
         SELECT c.completed_at AS last_completed_at
           FROM staff_todo_completions c
          WHERE c.todo_id = t.id
          ORDER BY c.completed_at DESC
          LIMIT 1
       ) lc ON true
      WHERE t.staff_id = $1 AND t.station = $2 AND t.archived_at IS NULL
      ORDER BY t.sort_order ASC, t.id ASC`,
    [staffId, station],
  );
  return r.rows.map(mapRow);
}

/**
 * Create a task. Recurring tasks join the station list's existing cycle
 * (inheriting interval + anchor from any live recurring sibling) so the whole
 * list keeps resetting in lockstep; the first task uses `intervalMs` (the
 * client's selected interval) or the default, anchored at now.
 */
export async function createStaffTodo(args: {
  staffId: number;
  station: string;
  kind: StaffTodoKind;
  text: string;
  intervalMs?: number | null;
}): Promise<StaffTodoRow> {
  const { staffId, station, kind, text } = args;

  let intervalMs: number | null = null;
  let anchorMs: number | null = null;
  if (kind === 'recurring') {
    const sib = await pool.query(
      `SELECT recur_interval_ms::bigint AS interval_ms,
              (EXTRACT(EPOCH FROM recur_anchor) * 1000)::bigint AS anchor_ms
         FROM staff_todos
        WHERE staff_id = $1 AND station = $2 AND kind = 'recurring' AND archived_at IS NULL
        ORDER BY id ASC LIMIT 1`,
      [staffId, station],
    );
    if (sib.rows[0]) {
      intervalMs = Number(sib.rows[0].interval_ms);
      anchorMs = Number(sib.rows[0].anchor_ms);
    } else {
      intervalMs = args.intervalMs && args.intervalMs > 0 ? args.intervalMs : DEFAULT_RECUR_INTERVAL_MS;
      anchorMs = Date.now();
    }
  }

  const r = await pool.query(
    `INSERT INTO staff_todos (staff_id, station, kind, text, sort_order, recur_interval_ms, recur_anchor)
     VALUES ($1, $2, $3, $4,
             COALESCE((SELECT MAX(sort_order) + 1 FROM staff_todos
                        WHERE staff_id = $1 AND station = $2 AND kind = $3 AND archived_at IS NULL), 0),
             $5, to_timestamp($6 / 1000.0))
     RETURNING id`,
    [staffId, station, kind, text, intervalMs, anchorMs],
  );
  const row = await getStaffTodo(staffId, Number(r.rows[0].id));
  if (!row) throw new Error('staff_todos insert did not return a readable row');
  return row;
}

export async function getStaffTodo(staffId: number, id: number): Promise<StaffTodoRow | null> {
  const r = await pool.query(
    `${SELECT_ROW} WHERE t.id = $2 AND t.staff_id = $1 AND t.archived_at IS NULL`,
    [staffId, id],
  );
  return r.rows[0] ? mapRow(r.rows[0]) : null;
}

/**
 * Set a task's checked state (absolute, not a flip — safe to retry).
 * General: stamps/clears `completed_at`. Recurring: logs a completion, or
 * deletes the current cycle's completions to uncheck.
 */
export async function setStaffTodoDone(
  staffId: number,
  id: number,
  done: boolean,
): Promise<StaffTodoRow | null> {
  const row = await getStaffTodo(staffId, id);
  if (!row) return null;

  // The post-write state is derived from `row` instead of re-fetching — this
  // runs on every checkbox click. On an uncheck, last_completed_at_ms is
  // reported as null even when prior-cycle history exists; done-ness math
  // treats both identically and the next GET restores the true value.
  const nowMs = Date.now();
  if (row.kind === 'general') {
    await pool.query(
      `UPDATE staff_todos
          SET completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $2 AND staff_id = $1`,
      [staffId, id, done],
    );
    return { ...row, completed_at_ms: done ? nowMs : null };
  }

  const periodStart = cyclePeriodStartMs(row.recur_anchor_ms!, row.recur_interval_ms!, nowMs);
  if (done) {
    // Skip the insert when already checked this cycle (idempotent retry).
    const already = row.last_completed_at_ms != null && row.last_completed_at_ms >= periodStart;
    if (already) return row;
    await pool.query(
      `INSERT INTO staff_todo_completions (todo_id, staff_id) VALUES ($1, $2)`,
      [id, staffId],
    );
    return { ...row, last_completed_at_ms: nowMs };
  }
  await pool.query(
    `DELETE FROM staff_todo_completions
      WHERE todo_id = $1 AND staff_id = $2 AND completed_at >= to_timestamp($3 / 1000.0)`,
    [id, staffId, periodStart],
  );
  return { ...row, last_completed_at_ms: null };
}

/**
 * Change the reset interval for a station's whole recurring list. Restarts the
 * cycle from now (matching the v1 chip behavior) and re-logs a completion for
 * every task that was checked under the old cycle, so the change doesn't
 * silently uncheck anything. One transaction. Returns the previous interval
 * (null when the list was empty) for the caller's audit diff.
 */
export async function setStaffTodoInterval(
  staffId: number,
  station: string,
  intervalMs: number,
): Promise<{ previousIntervalMs: number | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Tasks checked under the OLD cycle, before the anchor moves.
    const checked = await client.query(
      `SELECT t.id, t.recur_interval_ms::bigint AS interval_ms,
              EXISTS (
                SELECT 1 FROM staff_todo_completions c
                 WHERE c.todo_id = t.id
                   AND c.completed_at >= t.recur_anchor
                     + (floor(EXTRACT(EPOCH FROM (now() - t.recur_anchor)) * 1000 / t.recur_interval_ms)
                        * t.recur_interval_ms / 1000.0) * interval '1 second'
              ) AS is_done
         FROM staff_todos t
        WHERE t.staff_id = $1 AND t.station = $2 AND t.kind = 'recurring' AND t.archived_at IS NULL`,
      [staffId, station],
    );
    const previousIntervalMs = checked.rows[0] ? Number(checked.rows[0].interval_ms) : null;
    await client.query(
      `UPDATE staff_todos
          SET recur_interval_ms = $3, recur_anchor = now(), updated_at = now()
        WHERE staff_id = $1 AND station = $2 AND kind = 'recurring' AND archived_at IS NULL`,
      [staffId, station, intervalMs],
    );
    const doneIds = checked.rows.filter((r) => r.is_done).map((r) => Number(r.id));
    if (doneIds.length > 0) {
      await client.query(
        `INSERT INTO staff_todo_completions (todo_id, staff_id)
         SELECT unnest($1::bigint[]), $2`,
        [doneIds, staffId],
      );
    }
    await client.query('COMMIT');
    return { previousIntervalMs };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Soft-delete (archive) a task. Returns false when no live row matched. */
export async function archiveStaffTodo(staffId: number, id: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE staff_todos SET archived_at = now(), updated_at = now()
      WHERE id = $2 AND staff_id = $1 AND archived_at IS NULL`,
    [staffId, id],
  );
  return (r.rowCount ?? 0) > 0;
}
