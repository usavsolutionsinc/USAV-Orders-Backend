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
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

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
export async function detectReplenishmentNeeds(orgId?: OrgId): Promise<DetectionResult> {
  // Tenant-scoped path: GUC-wrapped transaction. `replenishment_tasks` has no
  // organization_id column (child-scoped via locations); we scope its reads and
  // the bin_contents/locations joins through the org-bearing `locations` parent
  // and the org-aligned bin_contents rows. The INSERT can't stamp org (no
  // column), but it runs inside the GUC transaction and its source data is org-
  // filtered, so an open task can only be created from this tenant's own bins.
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      // 1. Find low PICK_FACE positions (this org only).
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
                                AND loc.organization_id = bc.organization_id
         WHERE loc.bin_role = 'PICK_FACE'
           AND loc.is_active = true
           AND loc.locked_for_count = false
           AND bc.min_qty IS NOT NULL
           AND bc.qty < bc.min_qty
           AND bc.organization_id = $1
      `, [orgId]);

      const result: DetectionResult = {
        scannedPickFaces: lowQ.rowCount ?? 0,
        proposed: 0,
        inserted: 0,
        skippedExisting: 0,
      };

      // 2. For each low spot, propose qty + best source bin (this org only).
      for (const row of lowQ.rows) {
        const targetQty = row.max_qty ?? row.min_qty * 2;
        const moveQty = Math.max(1, targetQty - row.current_qty);

        const sourceQ = await client.query<{ id: number; qty: number }>(`
          SELECT bc.location_id AS id, bc.qty
            FROM bin_contents bc
            JOIN locations    loc ON loc.id = bc.location_id
                                  AND loc.organization_id = bc.organization_id
           WHERE bc.sku = $1
             AND loc.bin_role = 'RESERVE'
             AND loc.is_active = true
             AND loc.locked_for_count = false
             AND bc.qty > 0
             AND bc.organization_id = $2
           ORDER BY bc.qty DESC
           LIMIT 1
        `, [row.sku, orgId]);
        const fromBinId = sourceQ.rows[0]?.id ?? null;
        const actualQty = sourceQ.rows[0] ? Math.min(moveQty, sourceQ.rows[0].qty) : moveQty;

        result.proposed += 1;

        // 3. Insert. The partial UNIQUE silently rejects duplicates of open tasks.
        const insertQ = await client.query<{ id: number }>(`
          INSERT INTO replenishment_tasks (sku, from_bin_id, to_bin_id, qty, organization_id)
          VALUES ($1, $2, $3, $4, $5::uuid)
          ON CONFLICT (sku, to_bin_id) WHERE status IN ('REQUESTED','IN_PROGRESS')
            DO NOTHING
          RETURNING id
        `, [row.sku, fromBinId, row.to_bin_id, actualQty, orgId]);
        if (insertQ.rowCount && insertQ.rowCount > 0) {
          result.inserted += 1;
        } else {
          result.skippedExisting += 1;
        }
      }

      return result;
    });
  }

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
}, orgId?: OrgId): Promise<ClaimTaskResult> {
  // Tenant-scoped path: `replenishment_tasks` has no organization_id column, so
  // ownership is derived from its `to_bin_id → locations.organization_id` parent.
  // A task owned by another org reads as 404 (not 403) for both the disambiguating
  // check and the UPDATE.
  if (orgId) {
    const { rowCount } = await tenantQuery(
      orgId,
      `UPDATE replenishment_tasks rt
          SET status = 'IN_PROGRESS',
              assigned_staff_id = $2,
              started_at = NOW()
        FROM locations loc
        WHERE rt.id = $1
          AND loc.id = rt.to_bin_id
          AND loc.organization_id = $3
          AND rt.status = 'REQUESTED'`,
      [input.taskId, input.staffId, orgId],
    );
    if (rowCount === 0) {
      const checkQ = await tenantQuery<{ status: ReplenishmentTaskStatus }>(
        orgId,
        `SELECT rt.status
           FROM replenishment_tasks rt
           JOIN locations loc ON loc.id = rt.to_bin_id
                             AND loc.organization_id = $2
          WHERE rt.id = $1`,
        [input.taskId, orgId],
      );
      if (checkQ.rowCount === 0) return { ok: false, status: 404, error: 'task not found' };
      return { ok: false, status: 409, error: `task already ${checkQ.rows[0].status}` };
    }
    return { ok: true };
  }

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

export type ReleaseTaskResult =
  | { ok: true }
  | { ok: false; status: 404 | 409; error: string };

/** Injectable collaborators so unit tests run DB-free (house `Deps` pattern). */
export interface ReleaseTaskDeps {
  tenantQuery: typeof tenantQuery;
}

const defaultReleaseTaskDeps: ReleaseTaskDeps = { tenantQuery };

/**
 * Reversibility 5.7 — undo a claim: IN_PROGRESS → REQUESTED, clearing
 * assigned_staff_id + started_at so the task returns to the open queue.
 * 404 when the task doesn't exist (or belongs to another org); 409 when it
 * isn't IN_PROGRESS.
 */
export async function releaseTask(
  input: { taskId: number },
  orgId: OrgId,
  deps: ReleaseTaskDeps = defaultReleaseTaskDeps,
): Promise<ReleaseTaskResult> {
  // Tenant-scoped: `replenishment_tasks` ownership is derived from its
  // `to_bin_id → locations.organization_id` parent (same shape as claimTask).
  // A task owned by another org reads as 404, never 403.
  const { rowCount } = await deps.tenantQuery(
    orgId,
    `UPDATE replenishment_tasks rt
        SET status = 'REQUESTED',
            assigned_staff_id = NULL,
            started_at = NULL
      FROM locations loc
      WHERE rt.id = $1
        AND loc.id = rt.to_bin_id
        AND loc.organization_id = $2
        AND rt.status = 'IN_PROGRESS'`,
    [input.taskId, orgId],
  );
  if (rowCount === 0) {
    const checkQ = await deps.tenantQuery<{ status: ReplenishmentTaskStatus }>(
      orgId,
      `SELECT rt.status
         FROM replenishment_tasks rt
         JOIN locations loc ON loc.id = rt.to_bin_id
                           AND loc.organization_id = $2
        WHERE rt.id = $1`,
      [input.taskId, orgId],
    );
    if (checkQ.rowCount === 0) return { ok: false, status: 404, error: 'task not found' };
    return { ok: false, status: 409, error: `task is ${checkQ.rows[0].status}, expected IN_PROGRESS` };
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
}, orgId: OrgId): Promise<CompleteTaskResult> {
  if (input.qtyMoved <= 0) {
    return { ok: false, status: 409, error: 'qtyMoved must be > 0' };
  }

  // Tenant-scoped path: GUC-wrapped transaction. `replenishment_tasks` ownership
  // is derived from `to_bin_id → locations.organization_id`; bin_contents and
  // inventory_events are tenant-owned (org predicate / stamp). A cross-org task
  // reads as 404.
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const taskQ = await client.query<{
        id: number;
        sku: string;
        from_bin_id: number | null;
        to_bin_id: number;
        status: ReplenishmentTaskStatus;
      }>(
        `SELECT rt.id, rt.sku, rt.from_bin_id, rt.to_bin_id, rt.status
           FROM replenishment_tasks rt
           JOIN locations loc ON loc.id = rt.to_bin_id
                             AND loc.organization_id = $2
          WHERE rt.id = $1
          FOR UPDATE OF rt`,
        [input.taskId, orgId],
      );
      const task = taskQ.rows[0];
      if (!task) {
        return { ok: false, status: 404, error: 'task not found' };
      }
      if (task.status !== 'IN_PROGRESS') {
        return { ok: false, status: 409, error: `task is ${task.status}, expected IN_PROGRESS` };
      }

      let fromBinQty: number | null = null;
      if (task.from_bin_id) {
        const fromQ = await client.query<{ qty: number }>(
          `UPDATE bin_contents
              SET qty = qty - $3
            WHERE location_id = $1 AND sku = $2 AND qty >= $3
              AND organization_id = $4
          RETURNING qty`,
          [task.from_bin_id, task.sku, input.qtyMoved, orgId],
        );
        if (fromQ.rowCount === 0) {
          return { ok: false, status: 409, error: 'insufficient qty in source bin' };
        }
        fromBinQty = fromQ.rows[0].qty;
      }

      const toQ = await client.query<{ qty: number }>(
        `INSERT INTO bin_contents (location_id, sku, qty, organization_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (location_id, sku) DO UPDATE
           SET qty = bin_contents.qty + EXCLUDED.qty
         RETURNING qty`,
        [task.to_bin_id, task.sku, input.qtyMoved, orgId],
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
      }, orgId);

      return { ok: true, fromBinQty, toBinQty: toQ.rows[0].qty };
    });
  }

  // orgId is required, so the GUC-scoped path above always returns. The old
  // un-scoped pool.connect() fallback was removed: it inserted inventory_events
  // and bin_contents rows with a NULL organization_id (NOT NULL violation once
  // tenancy hardened) and is unreachable now.
  throw new Error('completeTask: orgId is required');
}

export type CancelTaskResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

export async function cancelTask(input: {
  taskId: number;
  reason: string;
  actorStaffId: number;
}, orgId?: OrgId): Promise<CancelTaskResult> {
  // Tenant-scoped path: ownership via `to_bin_id → locations.organization_id`.
  // Cross-org task reads as 404.
  if (orgId) {
    const { rowCount } = await tenantQuery(
      orgId,
      `UPDATE replenishment_tasks rt
          SET status = 'CANCELED',
              canceled_at = NOW(),
              cancel_reason = $2
        FROM locations loc
        WHERE rt.id = $1
          AND loc.id = rt.to_bin_id
          AND loc.organization_id = $3
          AND rt.status IN ('REQUESTED','IN_PROGRESS')`,
      [input.taskId, input.reason, orgId],
    );
    if (rowCount === 0) {
      const checkQ = await tenantQuery<{ status: ReplenishmentTaskStatus }>(
        orgId,
        `SELECT rt.status
           FROM replenishment_tasks rt
           JOIN locations loc ON loc.id = rt.to_bin_id
                             AND loc.organization_id = $2
          WHERE rt.id = $1`,
        [input.taskId, orgId],
      );
      if (checkQ.rowCount === 0) return { ok: false, status: 404, error: 'task not found' };
      return { ok: false, status: 409, error: `task already ${checkQ.rows[0].status}` };
    }
    return { ok: true };
  }

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
  orgId: OrgId,
) {
  // inventory_events is tenant-owned. The passed client is already inside the
  // GUC transaction; re-assert app.current_org on it defensively, then stamp
  // organization_id explicitly on the row.
  await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
  await client.query(
    `INSERT INTO inventory_events (
       event_type, actor_staff_id, station,
       sku, bin_id, prev_bin_id,
       payload, organization_id
     ) VALUES (
       'MOVED', $1, 'SYSTEM',
       $2, $3, $4,
       $5::jsonb, $6
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
      orgId,
    ],
  );
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listOpenTasks(orgId?: OrgId): Promise<ReplenishmentTaskRow[]> {
  // Tenant-scoped path: `replenishment_tasks` has no organization_id column;
  // scope via its `to_bin_id → locations.organization_id` parent.
  const { rows } = orgId
    ? await tenantQuery<{
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
        orgId,
        `SELECT rt.id, rt.sku, rt.from_bin_id, rt.to_bin_id, rt.qty, rt.status,
                rt.detected_at::text,
                rt.assigned_staff_id,
                rt.started_at::text,
                rt.completed_at::text,
                rt.qty_moved
           FROM replenishment_tasks rt
           JOIN locations loc ON loc.id = rt.to_bin_id
                             AND loc.organization_id = $1
          WHERE rt.status IN ('REQUESTED','IN_PROGRESS')
          ORDER BY rt.detected_at ASC`,
        [orgId],
      )
    : await pool.query<{
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
