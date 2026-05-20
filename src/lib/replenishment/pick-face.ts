/**
 * Pick-face replenishment — domain module for the bin-to-bin restock workflow.
 *
 * Pairs with `replenishment_tasks` table (2026-05-22 migration) and the
 * bin_role_enum from Phase A3. Distinct from `src/lib/replenishment.ts`, which
 * tracks vendor-PO replenishment from Zoho.
 *
 * Workflow:
 *   1. `detectReplenishmentNeeds()`   — scans PICK_FACE bins where qty < min_qty,
 *                                        emits a REQUESTED task per (sku, bin).
 *   2. `claimTask({ taskId, staffId })`     — REQUESTED → IN_PROGRESS.
 *   3. `completeTask({ taskId, qtyMoved })` — IN_PROGRESS → COMPLETE; updates
 *                                              bin_contents on both bins.
 *   4. `cancelTask({ taskId, reason })`     — anytime → CANCELED.
 *
 * Detection is idempotent via the partial UNIQUE on (sku, to_bin_id) WHERE
 * status IN ('REQUESTED','IN_PROGRESS'). Re-runs only insert tasks for newly
 * low bins; existing open tasks are left untouched.
 */

import pool from '@/lib/db';
import type { PoolClient } from 'pg';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReplenishmentTaskStatus = 'REQUESTED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELED';

export interface ReplenishmentTaskRow {
  id: number;
  sku: string;
  fromBinId: number | null;
  toBinId: number;
  qty: number;
  status: ReplenishmentTaskStatus;
  detectedAt: string;
  assignedStaffId: number | null;
  startedAt: string | null;
  completedAt: string | null;
  qtyMoved: number | null;
}

export interface DetectionResult {
  scannedPickFaces: number;
  proposed: number;
  inserted: number;
  skippedExisting: number;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Scan all PICK_FACE bins where qty is below min_qty and create REQUESTED
 * tasks for them. Source bin is the largest RESERVE/STORAGE bin holding the
 * same SKU; when none exists the task is created with `from_bin_id = NULL`
 * and the operator picks a source manually.
 *
 * Target qty = max_qty if set, else min_qty * 2 (sensible default cap).
 */
export async function detectReplenishmentNeeds(): Promise<DetectionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Find low PICK_FACE positions.
    const lowQ = await client.query<{
      to_bin_id: number;
      sku: string;
      current_qty: number;
      min_qty: number;
      max_qty: number | null;
    }>(`
      SELECT bc.location_id AS to_bin_id,
             bc.sku,
             bc.qty         AS current_qty,
             bc.min_qty,
             bc.max_qty
        FROM bin_contents bc
        JOIN locations    loc ON loc.id = bc.location_id
       WHERE loc.bin_role = 'PICK_FACE'
         AND loc.is_active = true
         AND loc.locked_for_count = false
         AND bc.min_qty IS NOT NULL
         AND bc.qty < bc.min_qty
    `);

    const result: DetectionResult = {
      scannedPickFaces: lowQ.rowCount ?? 0,
      proposed: 0,
      inserted: 0,
      skippedExisting: 0,
    };

    // 2. For each low spot, propose qty + best source bin.
    for (const row of lowQ.rows) {
      const targetQty = row.max_qty ?? row.min_qty * 2;
      const moveQty = Math.max(1, targetQty - row.current_qty);

      const sourceQ = await client.query<{ id: number; qty: number }>(`
        SELECT bc.location_id AS id, bc.qty
          FROM bin_contents bc
          JOIN locations    loc ON loc.id = bc.location_id
         WHERE bc.sku = $1
           AND loc.bin_role = 'RESERVE'
           AND loc.is_active = true
           AND loc.locked_for_count = false
           AND bc.qty > 0
         ORDER BY bc.qty DESC
         LIMIT 1
      `, [row.sku]);
      const fromBinId = sourceQ.rows[0]?.id ?? null;
      const actualQty = sourceQ.rows[0] ? Math.min(moveQty, sourceQ.rows[0].qty) : moveQty;

      result.proposed += 1;

      // 3. Insert. The partial UNIQUE silently rejects duplicates of open tasks.
      const insertQ = await client.query<{ id: number }>(`
        INSERT INTO replenishment_tasks (sku, from_bin_id, to_bin_id, qty)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (sku, to_bin_id) WHERE status IN ('REQUESTED','IN_PROGRESS')
          DO NOTHING
        RETURNING id
      `, [row.sku, fromBinId, row.to_bin_id, actualQty]);
      if (insertQ.rowCount && insertQ.rowCount > 0) {
        result.inserted += 1;
      } else {
        result.skippedExisting += 1;
      }
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export type ClaimTaskResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

export async function claimTask(input: {
  taskId: number;
  staffId: number;
}): Promise<ClaimTaskResult> {
  const { rowCount } = await pool.query(
    `UPDATE replenishment_tasks
        SET status = 'IN_PROGRESS',
            assigned_staff_id = $2,
            started_at = NOW()
      WHERE id = $1
        AND status = 'REQUESTED'`,
    [input.taskId, input.staffId],
  );
  if (rowCount === 0) {
    // Either missing or already claimed/completed/canceled — disambiguate.
    const checkQ = await pool.query<{ status: ReplenishmentTaskStatus }>(
      `SELECT status FROM replenishment_tasks WHERE id = $1`,
      [input.taskId],
    );
    if (checkQ.rowCount === 0) return { ok: false, status: 404, error: 'task not found' };
    return { ok: false, status: 409, error: `task already ${checkQ.rows[0].status}` };
  }
  return { ok: true };
}

export type CompleteTaskResult =
  | { ok: true; fromBinQty: number | null; toBinQty: number }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Apply the move: decrement from_bin, increment to_bin, mark COMPLETE.
 * All three writes in one transaction.
 */
export async function completeTask(input: {
  taskId: number;
  qtyMoved: number;
  actorStaffId: number;
}): Promise<CompleteTaskResult> {
  if (input.qtyMoved <= 0) {
    return { ok: false, status: 409, error: 'qtyMoved must be > 0' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskQ = await client.query<{
      id: number;
      sku: string;
      from_bin_id: number | null;
      to_bin_id: number;
      status: ReplenishmentTaskStatus;
    }>(
      `SELECT id, sku, from_bin_id, to_bin_id, status
         FROM replenishment_tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId],
    );
    const task = taskQ.rows[0];
    if (!task) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'task not found' };
    }
    if (task.status !== 'IN_PROGRESS') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `task is ${task.status}, expected IN_PROGRESS` };
    }

    let fromBinQty: number | null = null;
    if (task.from_bin_id) {
      const fromQ = await client.query<{ qty: number }>(
        `UPDATE bin_contents
            SET qty = qty - $3
          WHERE location_id = $1 AND sku = $2 AND qty >= $3
        RETURNING qty`,
        [task.from_bin_id, task.sku, input.qtyMoved],
      );
      if (fromQ.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, error: 'insufficient qty in source bin' };
      }
      fromBinQty = fromQ.rows[0].qty;
    }

    const toQ = await client.query<{ qty: number }>(
      `INSERT INTO bin_contents (location_id, sku, qty)
       VALUES ($1, $2, $3)
       ON CONFLICT (location_id, sku) DO UPDATE
         SET qty = bin_contents.qty + EXCLUDED.qty
       RETURNING qty`,
      [task.to_bin_id, task.sku, input.qtyMoved],
    );

    await client.query(
      `UPDATE replenishment_tasks
          SET status = 'COMPLETE',
              completed_at = NOW(),
              qty_moved = $2
        WHERE id = $1`,
      [task.id, input.qtyMoved],
    );

    // Use the inventory_events log to record the location move. This keeps
    // the timeline coherent with picks/packs that flow through the same log.
    await recordReplenishmentEvent(client, {
      taskId: task.id,
      sku: task.sku,
      fromBinId: task.from_bin_id,
      toBinId: task.to_bin_id,
      qty: input.qtyMoved,
      actorStaffId: input.actorStaffId,
    });

    await client.query('COMMIT');
    return { ok: true, fromBinQty, toBinQty: toQ.rows[0].qty };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

export type CancelTaskResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

export async function cancelTask(input: {
  taskId: number;
  reason: string;
  actorStaffId: number;
}): Promise<CancelTaskResult> {
  const { rowCount } = await pool.query(
    `UPDATE replenishment_tasks
        SET status = 'CANCELED',
            canceled_at = NOW(),
            cancel_reason = $2
      WHERE id = $1
        AND status IN ('REQUESTED','IN_PROGRESS')`,
    [input.taskId, input.reason],
  );
  if (rowCount === 0) {
    const checkQ = await pool.query<{ status: ReplenishmentTaskStatus }>(
      `SELECT status FROM replenishment_tasks WHERE id = $1`,
      [input.taskId],
    );
    if (checkQ.rowCount === 0) return { ok: false, status: 404, error: 'task not found' };
    return { ok: false, status: 409, error: `task already ${checkQ.rows[0].status}` };
  }
  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function recordReplenishmentEvent(
  client: PoolClient,
  input: {
    taskId: number;
    sku: string;
    fromBinId: number | null;
    toBinId: number;
    qty: number;
    actorStaffId: number;
  },
) {
  await client.query(
    `INSERT INTO inventory_events (
       event_type, actor_staff_id, station,
       sku, bin_id, prev_bin_id,
       payload
     ) VALUES (
       'MOVED', $1, 'SYSTEM',
       $2, $3, $4,
       $5::jsonb
     )`,
    [
      input.actorStaffId,
      input.sku,
      input.toBinId,
      input.fromBinId,
      JSON.stringify({
        source: 'replenishment.complete',
        taskId: input.taskId,
        qty: input.qty,
      }),
    ],
  );
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listOpenTasks(): Promise<ReplenishmentTaskRow[]> {
  const { rows } = await pool.query<{
    id: number;
    sku: string;
    from_bin_id: number | null;
    to_bin_id: number;
    qty: number;
    status: ReplenishmentTaskStatus;
    detected_at: string;
    assigned_staff_id: number | null;
    started_at: string | null;
    completed_at: string | null;
    qty_moved: number | null;
  }>(
    `SELECT id, sku, from_bin_id, to_bin_id, qty, status,
            detected_at::text,
            assigned_staff_id,
            started_at::text,
            completed_at::text,
            qty_moved
       FROM replenishment_tasks
      WHERE status IN ('REQUESTED','IN_PROGRESS')
      ORDER BY detected_at ASC`,
  );
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    fromBinId: r.from_bin_id,
    toBinId: r.to_bin_id,
    qty: r.qty,
    status: r.status,
    detectedAt: r.detected_at,
    assignedStaffId: r.assigned_staff_id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    qtyMoved: r.qty_moved,
  }));
}
