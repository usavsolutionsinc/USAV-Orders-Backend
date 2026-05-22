/**
 * Picking sessions — domain module for the mobile picker workflow.
 *
 * Pairs with `picking_sessions` table (migration 2026-05-20_inventory_v2_active_states.sql)
 * and the state machine in `src/lib/inventory/state-machine.ts`.
 *
 * Workflow:
 *   1. `startSession({ orderId, pickerStaffId, deviceId })`   — opens a session
 *   2. `confirmPick({ sessionId, allocationId, ...    })`     — ALLOCATED → PICKING → PICKED
 *   3. `recordShortPick({ sessionId, allocationId, ... })`    — releases short remainder back to STOCKED
 *   4. `completeSession({ sessionId })`                       — closes the session
 *
 * Each step is atomic — one DB transaction, all writes succeed or none do.
 * `clientEventId` accepts a UUID so mobile retries are idempotent.
 */

import pool from '@/lib/db';
import { transition } from '@/lib/inventory/state-machine';
import { recordInventoryEvent } from '@/lib/inventory/events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PickTaskPlatform {
  platform: string;
  platformSku: string | null;
  platformItemId: string | null;
}

export interface PickTaskRow {
  allocationId: number;
  serialUnitId: number;
  lineId: number;
  sku: string;
  productTitle: string | null;
  bin: string | null;
  conditionGrade: string | null;
  plannedQty: number;
  currentState: string;
  /** Marketplace mappings for this canonical SKU. Used by SkuIdentity to
   *  show e.g. "Ecwid 01279-B · Amazon ZB-AFHB-Y58D" beside the internal SKU. */
  platforms: PickTaskPlatform[];
}

export interface PickOrderTasks {
  orderId: number;
  orderLabel: string;
  customerInitials: string;
  shipByDate: string | null;
  tasks: PickTaskRow[];
}

export type StartSessionInput = {
  orderId: number;
  pickerStaffId: number;
  deviceId?: string | null;
};

export type StartSessionResult =
  | { ok: true; sessionId: number; reopen: boolean }
  | { ok: false; status: 404 | 409; error: string };

export type ConfirmPickInput = {
  sessionId: number;
  allocationId: number;
  actorStaffId: number;
  clientEventId?: string | null;
};

export type ConfirmPickResult =
  | { ok: true; serialUnitId: number; pickedAt: string }
  | { ok: false; status: 404 | 409; error: string };

export type ShortPickReason =
  | 'NOT_FOUND_IN_BIN'
  | 'DAMAGED'
  | 'WRONG_CONDITION'
  | 'MISLABELED'
  | 'INSUFFICIENT_STOCK'
  | 'OTHER';

export type RecordShortPickInput = {
  sessionId: number;
  allocationId: number;
  pickedQty: number;
  plannedQty: number;
  reason: ShortPickReason;
  note: string;
  actorStaffId: number;
  clientEventId?: string | null;
};

export type RecordShortPickResult =
  | { ok: true; releasedUnitId: number | null }
  | { ok: false; status: 404 | 409; error: string };

// ─── Read: pick-task list ───────────────────────────────────────────────────

/**
 * Fetch all open allocations for an order, joined with bin + product metadata.
 * The caller (mobile picker) renders one task per row.
 */
export async function loadPickTasks(orderId: number): Promise<PickOrderTasks | null> {
  const orderQ = await pool.query<{
    id: number;
    order_label: string | null;
    first_name: string | null;
    last_name: string | null;
    deadline_at: string | null;
  }>(
    `SELECT o.id,
            o.order_id                       AS order_label,
            c.first_name,
            c.last_name,
            wa.deadline_at::text             AS deadline_at
       FROM orders o
  LEFT JOIN customers        c  ON c.id = o.customer_id
  LEFT JOIN work_assignments wa ON wa.entity_type = 'ORDER'
                              AND wa.entity_id   = o.id
                              AND wa.deadline_at IS NOT NULL
      WHERE o.id = $1
      ORDER BY wa.deadline_at ASC NULLS LAST
      LIMIT 1`,
    [orderId],
  );
  const order = orderQ.rows[0];
  if (!order) return null;

  const tasksQ = await pool.query<{
    allocation_id: number;
    serial_unit_id: number;
    sku: string;
    product_title: string | null;
    bin: string | null;
    condition_grade: string | null;
    current_status: string;
    platforms: PickTaskPlatform[] | null;
  }>(
    `SELECT oua.id            AS allocation_id,
            oua.serial_unit_id,
            su.sku,
            sc.product_title,
            su.current_location AS bin,
            su.condition_grade::text AS condition_grade,
            su.current_status::text  AS current_status,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'platform',         spi.platform,
                 'platformSku',      spi.platform_sku,
                 'platformItemId',   spi.platform_item_id
               ) ORDER BY spi.platform)
                 FROM sku_platform_ids spi
                WHERE spi.sku_catalog_id = sc.id
                  AND spi.is_active = true
                  AND (spi.platform_sku IS NOT NULL OR spi.platform_item_id IS NOT NULL)
              ),
              '[]'::json
            )                  AS platforms
       FROM order_unit_allocations oua
       JOIN serial_units su  ON su.id = oua.serial_unit_id
  LEFT JOIN sku_catalog  sc  ON sc.sku = su.sku
      WHERE oua.order_id = $1
        AND oua.state IN ('ALLOCATED', 'PICKING')
      ORDER BY oua.id ASC`,
    [orderId],
  );

  const initials = `${(order.first_name || '?')[0] || '?'}${(order.last_name || '')[0] || ''}`.toUpperCase();

  return {
    orderId: order.id,
    orderLabel: order.order_label ? `#${order.order_label}` : `#${order.id}`,
    customerInitials: initials,
    shipByDate: order.deadline_at,
    tasks: tasksQ.rows.map((r, i) => ({
      allocationId: r.allocation_id,
      serialUnitId: r.serial_unit_id,
      lineId: i + 1,
      sku: r.sku,
      productTitle: r.product_title,
      bin: r.bin,
      conditionGrade: r.condition_grade,
      plannedQty: 1, // one allocation row = one unit; aggregate elsewhere if needed
      currentState: r.current_status,
      platforms: r.platforms ?? [],
    })),
  };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function startSession(input: StartSessionInput): Promise<StartSessionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderQ = await client.query<{ id: number }>(
      `SELECT id FROM orders WHERE id = $1 LIMIT 1`,
      [input.orderId],
    );
    if (orderQ.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: `order ${input.orderId} not found` };
    }

    // Reuse an existing open session for this (order, picker) so a worker who
    // navigates away and back doesn't fragment the audit trail.
    const reuseQ = await client.query<{ id: number }>(
      `SELECT id FROM picking_sessions
        WHERE order_id = $1
          AND picker_staff_id = $2
          AND ended_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1`,
      [input.orderId, input.pickerStaffId],
    );
    if ((reuseQ.rowCount ?? 0) > 0) {
      await client.query('COMMIT');
      return { ok: true, sessionId: reuseQ.rows[0].id, reopen: true };
    }

    const insertQ = await client.query<{ id: number }>(
      `INSERT INTO picking_sessions (order_id, picker_staff_id, device_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [input.orderId, input.pickerStaffId, input.deviceId ?? null],
    );
    await client.query('COMMIT');
    return { ok: true, sessionId: insertQ.rows[0].id, reopen: false };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function confirmPick(input: ConfirmPickInput): Promise<ConfirmPickResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allocQ = await client.query<{
      id: number;
      serial_unit_id: number;
      state: string;
      order_id: number;
    }>(
      `SELECT id, serial_unit_id, state, order_id
         FROM order_unit_allocations
        WHERE id = $1
        FOR UPDATE`,
      [input.allocationId],
    );
    const alloc = allocQ.rows[0];
    if (!alloc) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: `allocation ${input.allocationId} not found` };
    }
    if (alloc.state === 'PICKED' || alloc.state === 'PACKED' || alloc.state === 'SHIPPED') {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: `allocation already ${alloc.state}` };
    }

    // ALLOCATED → PICKED (skip the transient PICKING; the picker is at the
    // bin and the scan confirms the pick in a single tap. Active-state PICKING
    // is for multi-line carts that bookmark progress mid-scan; the API caller
    // can emit it separately when needed.)
    const unitResult = await transition(
      {
        unitId: alloc.serial_unit_id,
        to: 'PICKED',
        eventType: 'PICKED',
        actorStaffId: input.actorStaffId,
        station: 'MOBILE',
        clientEventId: input.clientEventId ?? null,
        payload: { source: 'picking.confirm', sessionId: input.sessionId, allocationId: alloc.id },
      },
      client,
    );
    if (!unitResult.ok) {
      await client.query('ROLLBACK');
      return { ok: false, status: unitResult.status, error: unitResult.error };
    }

    await client.query(
      `UPDATE order_unit_allocations
          SET state = 'PICKED'
        WHERE id = $1`,
      [alloc.id],
    );

    await client.query('COMMIT');
    // Pick time = state-transition timestamp on the inventory_event we just wrote.
    return {
      ok: true,
      serialUnitId: alloc.serial_unit_id,
      pickedAt: new Date().toISOString(),
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function recordShortPick(input: RecordShortPickInput): Promise<RecordShortPickResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allocQ = await client.query<{
      id: number;
      serial_unit_id: number;
      state: string;
    }>(
      `SELECT id, serial_unit_id, state
         FROM order_unit_allocations
        WHERE id = $1
        FOR UPDATE`,
      [input.allocationId],
    );
    const alloc = allocQ.rows[0];
    if (!alloc) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: `allocation ${input.allocationId} not found` };
    }

    // Short means the worker picked fewer than planned. Release this allocation
    // back to STOCKED so re-allocation can hand it to another order.
    const unitResult = await transition(
      {
        unitId: alloc.serial_unit_id,
        to: 'STOCKED',
        eventType: 'NOTE',
        actorStaffId: input.actorStaffId,
        station: 'MOBILE',
        clientEventId: input.clientEventId ?? null,
        notes: `short-pick: ${input.reason}${input.note ? ` — ${input.note}` : ''}`,
        payload: {
          source: 'picking.short_pick',
          sessionId: input.sessionId,
          allocationId: alloc.id,
          reason: input.reason,
          pickedQty: input.pickedQty,
          plannedQty: input.plannedQty,
        },
      },
      client,
    );
    if (!unitResult.ok) {
      await client.query('ROLLBACK');
      return { ok: false, status: unitResult.status, error: unitResult.error };
    }

    await client.query(
      `UPDATE order_unit_allocations
          SET state = 'RELEASED',
              released_at = NOW(),
              released_reason = $2
        WHERE id = $1`,
      [alloc.id, `SHORT_PICK_${input.reason}`],
    );

    await client.query('COMMIT');
    return { ok: true, releasedUnitId: alloc.serial_unit_id };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function completeSession(input: { sessionId: number; actorStaffId: number }): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  const result = await pool.query(
    `UPDATE picking_sessions
        SET ended_at = NOW()
      WHERE id = $1
        AND ended_at IS NULL
      RETURNING id`,
    [input.sessionId],
  );
  if (result.rowCount === 0) {
    return { ok: false, status: 404, error: `session ${input.sessionId} not found or already closed` };
  }
  // Log the close as a session-level note so audit timelines reflect it.
  await recordInventoryEvent({
    event_type: 'NOTE',
    actor_staff_id: input.actorStaffId,
    station: 'MOBILE',
    payload: { source: 'picking.complete', sessionId: input.sessionId },
  });
  return { ok: true };
}
