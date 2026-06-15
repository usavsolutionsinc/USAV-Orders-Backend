import pool from '@/lib/db';
import { transition } from '@/lib/inventory/state-machine';
import { tapWorkflow } from '@/lib/workflow/tap';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * Per-serial repair history (unit_repairs) + the failure modes each repair
 * resolves (repair_failure_resolutions). See
 * docs/condition-grading-repair-qc-plan.md §4.5 / 2026-06-07_unit_repairs.sql.
 *
 * Lifecycle uses the existing IN_REPAIR / REPAIR_DONE serial statuses and the
 * REPAIR_STARTED / REPAIR_COMPLETED inventory events. The status change is
 * routed through the guarded state machine (transition()) on the SAME pg
 * transaction, so the serial status and its inventory event are written
 * atomically. A rejected transition is non-fatal (drift-tolerant): the repair
 * row still commits and the *_event_id back-link is simply left null.
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

export async function listUnitRepairs(serialUnitId: number, orgId?: OrgId): Promise<UnitRepairRow[]> {
  // Tenant-scoped read: unit_repairs is tenant-owned (has organization_id). The
  // rfr subquery (repair_failure_resolutions, tenant-owned) is org-aligned to ur;
  // failure_modes is a global reference table (no organization_id) so its join
  // stays bare. Staff joins are integer surrogate-PK (id) so they stay bare.
  if (orgId) {
    const r = await tenantQuery<UnitRepairRow>(
      orgId,
      `SELECT ur.*,
              sb.name AS started_by_name,
              cb.name AS completed_by_name,
              COALESCE(
                (SELECT json_agg(json_build_object('id', fm.id, 'code', fm.code, 'label', fm.label) ORDER BY fm.label)
                   FROM repair_failure_resolutions rfr
                   JOIN failure_modes fm ON fm.id = rfr.failure_mode_id
                  WHERE rfr.repair_id = ur.id
                    AND rfr.organization_id = ur.organization_id),
                '[]'::json
              ) AS failure_modes
         FROM unit_repairs ur
    LEFT JOIN staff sb ON sb.id = ur.started_by_staff_id
    LEFT JOIN staff cb ON cb.id = ur.completed_by_staff_id
        WHERE ur.serial_unit_id = $1
          AND ur.organization_id = $2
     ORDER BY ur.created_at DESC`,
      [serialUnitId, orgId],
    );
    return r.rows;
  }
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
export async function openRepair(
  params: {
    serialUnitId: number;
    summary: string;
    status?: 'pending' | 'in_progress';
    failureModeIds?: number[];
    rmaId?: number | null;
    repairServiceId?: number | null;
    staffId?: number | null;
    clientEventId?: string | null;
  },
  orgId?: OrgId,
): Promise<UnitRepairRow> {
  const status = params.status === 'pending' ? 'pending' : 'in_progress';

  // Shared transactional body. Runs on a single client (which already owns its
  // transaction): the raw-pool path opens/commits BEGIN itself; the tenant path
  // runs inside withTenantTransaction (BEGIN + set_config('app.current_org') +
  // COMMIT are handled by the wrapper). When orgId is present we add an explicit
  // serial_units.organization_id predicate (cross-tenant miss → "unit not
  // found"), org-derived child inserts already subquery from the parent, and the
  // orgId is threaded into transition().
  const body = async (client: import('pg').PoolClient): Promise<number> => {
    const unit = await client.query<{ sku: string | null; current_status: string | null }>(
      orgId
        ? `SELECT sku, current_status::text AS current_status FROM serial_units WHERE id = $1 AND organization_id = $2 FOR UPDATE`
        : `SELECT sku, current_status::text AS current_status FROM serial_units WHERE id = $1 FOR UPDATE`,
      orgId ? [params.serialUnitId, orgId] : [params.serialUnitId],
    );
    if (unit.rows.length === 0) {
      throw new Error('unit not found');
    }

    const ins = await client.query<{ id: number }>(
      `INSERT INTO unit_repairs
         (serial_unit_id, status, summary, started_at, started_by_staff_id, rma_id, repair_service_id, organization_id)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, (SELECT organization_id FROM serial_units WHERE id = $1))
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
    const newRepairId = ins.rows[0].id;

    for (const modeId of params.failureModeIds ?? []) {
      await client.query(
        `INSERT INTO repair_failure_resolutions (repair_id, failure_mode_id, organization_id)
         VALUES ($1, $2, (SELECT organization_id FROM unit_repairs WHERE id = $1)) ON CONFLICT DO NOTHING`,
        [newRepairId, modeId],
      );
    }

    // Route the IN_REPAIR transition through the guarded state machine (atomic
    // status + single REPAIR_STARTED event on the shared txn). DRIFT: if the
    // guard rejects, do NOT throw — that would roll back the whole repair.
    // Pass orgId (state-machine accepts an optional trailing orgId) so the unit
    // read/write inside transition() is org-scoped on the same client.
    const t = await transition(
      {
        unitId: params.serialUnitId,
        to: 'IN_REPAIR',
        eventType: 'REPAIR_STARTED',
        actorStaffId: params.staffId ?? null,
        station: 'TECH',
        clientEventId: params.clientEventId ?? null,
        payload: { repair_id: newRepairId, failure_mode_ids: params.failureModeIds ?? [] },
      },
      client,
      orgId,
    );
    const startEventId = t.ok ? t.eventId : null;
    if (!t.ok) {
      console.warn('[openRepair] IN_REPAIR transition rejected (non-fatal)', t.status, t.error);
    } else {
      await client.query(`UPDATE unit_repairs SET start_event_id = $2 WHERE id = $1`, [newRepairId, startEventId]);
    }

    return newRepairId;
  };

  let repairId: number;
  if (orgId) {
    repairId = await withTenantTransaction(orgId, body);
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      repairId = await body(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const row = orgId
    ? await tenantQuery<UnitRepairRow>(orgId, `SELECT * FROM unit_repairs WHERE id = $1 AND organization_id = $2`, [repairId, orgId])
    : await pool.query<UnitRepairRow>(`SELECT * FROM unit_repairs WHERE id = $1`, [repairId]);
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
  orgId?: OrgId,
): Promise<UnitRepairRow | null> {
  let serialUnitId: number | null = null;
  let becameTerminal = false;
  let resolvedTagCount = 0;
  // Sentinel for an org-ownership miss on the FOR UPDATE read: the raw path
  // ROLLBACKs + returns null directly; the tenant path can't early-return out of
  // the wrapper, so the body returns this and the caller maps it to null.
  let notFound = false;

  // Shared transactional body. Runs on a single client owning its own
  // transaction (raw-pool path BEGIN/COMMITs itself; tenant path runs inside
  // withTenantTransaction with set_config('app.current_org') already applied).
  // When orgId is present: unit_repairs read/UPDATE carry an explicit
  // organization_id predicate (cross-tenant miss → notFound → null = 404);
  // unit_failure_tags has NO organization_id column so it is scoped via its
  // org-bearing parent serial_units; transition() gets the threaded orgId.
  const body = async (client: import('pg').PoolClient): Promise<void> => {
    const cur = await client.query<{ serial_unit_id: number; status: string }>(
      orgId
        ? `SELECT serial_unit_id, status FROM unit_repairs WHERE id = $1 AND organization_id = $2 FOR UPDATE`
        : `SELECT serial_unit_id, status FROM unit_repairs WHERE id = $1 FOR UPDATE`,
      orgId ? [repairId, orgId] : [repairId],
    );
    if (cur.rows.length === 0) {
      notFound = true;
      return;
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
    if (orgId) {
      values.push(orgId);
      await client.query(
        `UPDATE unit_repairs SET ${sets.join(', ')} WHERE id = $${idx} AND organization_id = $${idx + 1}`,
        values,
      );
    } else {
      await client.query(`UPDATE unit_repairs SET ${sets.join(', ')} WHERE id = $${idx}`, values);
    }

    if (nextStatus === 'completed') {
      // Resolve the unit's OPEN tags this repair addresses; stamp the repair.
      // unit_failure_tags has NO organization_id column → scope via its parent
      // serial_units (su.organization_id) when orgId is present, and align the
      // rfr subquery on org.
      const res = orgId
        ? await client.query(
            `UPDATE unit_failure_tags t
                SET resolution_status = 'resolved', resolved_repair_id = $1
               WHERE t.serial_unit_id = $2
                 AND t.resolution_status = 'open'
                 AND EXISTS (
                   SELECT 1 FROM serial_units su
                    WHERE su.id = t.serial_unit_id AND su.organization_id = $3
                 )
                 AND t.failure_mode_id IN (
                   SELECT failure_mode_id FROM repair_failure_resolutions
                    WHERE repair_id = $1 AND organization_id = $3
                 )`,
            [repairId, serialUnitId, orgId],
          )
        : await client.query(
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
      // Route the REPAIR_DONE transition through the guarded state machine
      // (atomic status + single REPAIR_COMPLETED event on the shared txn).
      // DRIFT: if the guard rejects, do NOT throw — keep the repair completion.
      // Thread orgId so transition()'s unit read/write is org-scoped.
      const t = await transition(
        {
          unitId: serialUnitId,
          to: 'REPAIR_DONE',
          eventType: 'REPAIR_COMPLETED',
          actorStaffId: params.staffId ?? null,
          station: 'TECH',
          clientEventId: params.clientEventId ?? null,
          notes: params.status && params.status !== 'completed' ? `status: ${params.status}` : null,
          payload: { repair_id: repairId, status: params.status ?? 'completed', resolved_tags: resolvedTagCount },
        },
        client,
        orgId,
      );
      const doneEventId = t.ok ? t.eventId : null;
      if (!t.ok) {
        console.warn('[updateRepair] REPAIR_DONE transition rejected (non-fatal)', t.status, t.error);
      } else {
        await client.query(`UPDATE unit_repairs SET done_event_id = $2 WHERE id = $1`, [repairId, doneEventId]);
      }
    }
  };

  if (orgId) {
    await withTenantTransaction(orgId, body);
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await body(client);
      if (notFound) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  if (notFound) return null;

  if (becameTerminal && serialUnitId != null) {
    // Workflow-engine tap (fire-and-forget — never throws). Only a repair
    // that lands on 'completed' fires the repair node's `repaired` port
    // (→ back to inspection for re-test); 'failed'/'scrapped' repairs leave
    // the unit parked at the repair node until a disposition lane exists.
    if (params.status === 'completed') {
      await tapWorkflow({
        serialUnitId,
        event: 'repair_completed',
        input: { repairId },
        staffId: params.staffId ?? null,
        source: 'manual',
        orgId: orgId ?? null,
      });
    }
  }

  const row = orgId
    ? await tenantQuery<UnitRepairRow>(orgId, `SELECT * FROM unit_repairs WHERE id = $1 AND organization_id = $2`, [repairId, orgId])
    : await pool.query<UnitRepairRow>(`SELECT * FROM unit_repairs WHERE id = $1`, [repairId]);
  return row.rows[0] ?? null;
}

export { OPEN_STATUSES, DONE_STATUSES };
