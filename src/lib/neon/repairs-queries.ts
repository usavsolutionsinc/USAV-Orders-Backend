import pool from '@/lib/db';
import { appendInventoryEvent } from '@/lib/repositories/inventory/inventoryEvents';

/**
 * Per-serial repair history (unit_repairs) + the failure modes each repair
 * resolves (repair_failure_resolutions). See
 * docs/condition-grading-repair-qc-plan.md §4.5 / 2026-06-07_unit_repairs.sql.
 *
 * Lifecycle uses the existing IN_REPAIR / REPAIR_DONE serial statuses and the
 * REPAIR_STARTED / REPAIR_COMPLETED inventory events. The event write runs on
 * the Drizzle neon-http connection (appendInventoryEvent) AFTER the pg
 * transaction commits — the same standalone-event pattern the grade/test
 * routes use — so the core rows stay atomic and the event is best-effort.
 */

export interface RepairPart {
  sku?: string;
  qty?: number;
  cost_cents?: number;
  note?: string;
}

export interface UnitRepairRow {
  id: number;
  serial_unit_id: number;
  status: string;
  summary: string;
  parts_used: RepairPart[] | null;
  labor_minutes: number | null;
  cost_cents: number | null;
  started_at: string | null;
  started_by_staff_id: number | null;
  completed_at: string | null;
  completed_by_staff_id: number | null;
  rma_id: number | null;
  repair_service_id: number | null;
  start_event_id: number | null;
  done_event_id: number | null;
  created_at: string;
  updated_at: string;
  // Joined for display.
  started_by_name?: string | null;
  completed_by_name?: string | null;
  failure_modes?: { id: number; code: string; label: string }[];
}

const OPEN_STATUSES = new Set(['pending', 'in_progress']);
const DONE_STATUSES = new Set(['completed', 'failed', 'scrapped']);

export async function listUnitRepairs(serialUnitId: number): Promise<UnitRepairRow[]> {
  const r = await pool.query<UnitRepairRow>(
    `SELECT ur.*,
            sb.name AS started_by_name,
            cb.name AS completed_by_name,
            COALESCE(
              (SELECT json_agg(json_build_object('id', fm.id, 'code', fm.code, 'label', fm.label) ORDER BY fm.label)
                 FROM repair_failure_resolutions rfr
                 JOIN failure_modes fm ON fm.id = rfr.failure_mode_id
                WHERE rfr.repair_id = ur.id),
              '[]'::json
            ) AS failure_modes
       FROM unit_repairs ur
  LEFT JOIN staff sb ON sb.id = ur.started_by_staff_id
  LEFT JOIN staff cb ON cb.id = ur.completed_by_staff_id
      WHERE ur.serial_unit_id = $1
   ORDER BY ur.created_at DESC`,
    [serialUnitId],
  );
  return r.rows;
}

/**
 * Open a repair: insert the row (in_progress by default), link failure modes,
 * and move the unit to IN_REPAIR. Emits REPAIR_STARTED.
 */
export async function openRepair(params: {
  serialUnitId: number;
  summary: string;
  status?: 'pending' | 'in_progress';
  failureModeIds?: number[];
  rmaId?: number | null;
  repairServiceId?: number | null;
  staffId?: number | null;
  clientEventId?: string | null;
}): Promise<UnitRepairRow> {
  const status = params.status === 'pending' ? 'pending' : 'in_progress';
  const client = await pool.connect();
  let repairId: number;
  let sku: string | null = null;
  let prevStatus: string | null = null;
  try {
    await client.query('BEGIN');

    const unit = await client.query<{ sku: string | null; current_status: string | null }>(
      `SELECT sku, current_status::text AS current_status FROM serial_units WHERE id = $1 FOR UPDATE`,
      [params.serialUnitId],
    );
    if (unit.rows.length === 0) {
      throw new Error('unit not found');
    }
    sku = unit.rows[0].sku;
    prevStatus = unit.rows[0].current_status;

    const ins = await client.query<{ id: number }>(
      `INSERT INTO unit_repairs
         (serial_unit_id, status, summary, started_at, started_by_staff_id, rma_id, repair_service_id)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6)
       RETURNING id`,
      [
        params.serialUnitId,
        status,
        params.summary.trim(),
        params.staffId ?? null,
        params.rmaId ?? null,
        params.repairServiceId ?? null,
      ],
    );
    repairId = ins.rows[0].id;

    for (const modeId of params.failureModeIds ?? []) {
      await client.query(
        `INSERT INTO repair_failure_resolutions (repair_id, failure_mode_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [repairId, modeId],
      );
    }

    await client.query(
      `UPDATE serial_units SET current_status = 'IN_REPAIR', updated_at = NOW() WHERE id = $1`,
      [params.serialUnitId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Standalone event (neon-http) + back-link. Best-effort.
  try {
    const { event } = await appendInventoryEvent({
      eventType: 'REPAIR_STARTED',
      clientEventId: params.clientEventId ?? null,
      actorStaffId: params.staffId ?? null,
      station: 'TECH',
      serialUnitId: params.serialUnitId,
      sku,
      prevStatus,
      nextStatus: 'IN_REPAIR',
      payload: { repair_id: repairId, failure_mode_ids: params.failureModeIds ?? [] },
    });
    await pool.query(`UPDATE unit_repairs SET start_event_id = $2 WHERE id = $1`, [repairId, event.id]);
  } catch (eventErr) {
    console.warn('[openRepair] REPAIR_STARTED event failed (non-fatal)', eventErr);
  }

  const row = await pool.query<UnitRepairRow>(`SELECT * FROM unit_repairs WHERE id = $1`, [repairId]);
  return row.rows[0];
}

/**
 * Update a repair. On a terminal status (completed/failed/scrapped) sets the
 * completion fields; on 'completed' it also resolves the unit's OPEN failure
 * tags whose mode this repair addresses, and moves the unit to REPAIR_DONE.
 * Emits REPAIR_COMPLETED on terminal transitions.
 */
export async function updateRepair(
  repairId: number,
  params: {
    status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'scrapped';
    summary?: string;
    partsUsed?: RepairPart[] | null;
    laborMinutes?: number | null;
    costCents?: number | null;
    staffId?: number | null;
    clientEventId?: string | null;
  },
): Promise<UnitRepairRow | null> {
  const client = await pool.connect();
  let serialUnitId: number | null = null;
  let sku: string | null = null;
  let prevStatus: string | null = null;
  let becameTerminal = false;
  let resolvedTagCount = 0;
  try {
    await client.query('BEGIN');

    const cur = await client.query<{ serial_unit_id: number; status: string }>(
      `SELECT serial_unit_id, status FROM unit_repairs WHERE id = $1 FOR UPDATE`,
      [repairId],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    serialUnitId = cur.rows[0].serial_unit_id;
    const nextStatus = params.status ?? cur.rows[0].status;
    becameTerminal = DONE_STATUSES.has(nextStatus) && !DONE_STATUSES.has(cur.rows[0].status);

    const sets: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;
    if (params.status !== undefined) { sets.push(`status = $${idx++}`); values.push(params.status); }
    if (params.summary !== undefined) { sets.push(`summary = $${idx++}`); values.push(params.summary.trim()); }
    if (params.partsUsed !== undefined) {
      sets.push(`parts_used = $${idx++}::jsonb`);
      values.push(params.partsUsed != null ? JSON.stringify(params.partsUsed) : null);
    }
    if (params.laborMinutes !== undefined) { sets.push(`labor_minutes = $${idx++}`); values.push(params.laborMinutes ?? null); }
    if (params.costCents !== undefined) { sets.push(`cost_cents = $${idx++}`); values.push(params.costCents ?? null); }
    if (becameTerminal) {
      sets.push(`completed_at = NOW()`);
      sets.push(`completed_by_staff_id = $${idx++}`); values.push(params.staffId ?? null);
    }
    values.push(repairId);
    await client.query(`UPDATE unit_repairs SET ${sets.join(', ')} WHERE id = $${idx}`, values);

    if (nextStatus === 'completed') {
      // Resolve the unit's OPEN tags this repair addresses; stamp the repair.
      const res = await client.query(
        `UPDATE unit_failure_tags t
            SET resolution_status = 'resolved', resolved_repair_id = $1
          WHERE t.serial_unit_id = $2
            AND t.resolution_status = 'open'
            AND t.failure_mode_id IN (
              SELECT failure_mode_id FROM repair_failure_resolutions WHERE repair_id = $1
            )`,
        [repairId, serialUnitId],
      );
      resolvedTagCount = res.rowCount ?? 0;
    }

    if (becameTerminal) {
      const su = await client.query<{ sku: string | null; current_status: string | null }>(
        `SELECT sku, current_status::text AS current_status FROM serial_units WHERE id = $1`,
        [serialUnitId],
      );
      sku = su.rows[0]?.sku ?? null;
      prevStatus = su.rows[0]?.current_status ?? null;
      await client.query(
        `UPDATE serial_units SET current_status = 'REPAIR_DONE', updated_at = NOW() WHERE id = $1`,
        [serialUnitId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (becameTerminal && serialUnitId != null) {
    try {
      const { event } = await appendInventoryEvent({
        eventType: 'REPAIR_COMPLETED',
        clientEventId: params.clientEventId ?? null,
        actorStaffId: params.staffId ?? null,
        station: 'TECH',
        serialUnitId,
        sku,
        prevStatus,
        nextStatus: 'REPAIR_DONE',
        notes: params.status && params.status !== 'completed' ? `status: ${params.status}` : null,
        payload: { repair_id: repairId, status: params.status ?? 'completed', resolved_tags: resolvedTagCount },
      });
      await pool.query(`UPDATE unit_repairs SET done_event_id = $2 WHERE id = $1`, [repairId, event.id]);
    } catch (eventErr) {
      console.warn('[updateRepair] REPAIR_COMPLETED event failed (non-fatal)', eventErr);
    }
  }

  const row = await pool.query<UnitRepairRow>(`SELECT * FROM unit_repairs WHERE id = $1`, [repairId]);
  return row.rows[0] ?? null;
}

export { OPEN_STATUSES, DONE_STATUSES };
