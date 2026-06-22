/**
 * Workflow engine — unpark / recovery path (Phase 1.0).
 *
 * advanceItem() parks a unit as `blocked` (a node returned await:true) or
 * `error` (a node threw, or its type vanished). Until now nothing reset those
 * back to `active`, so an errored unit silently died — no UI, no retry. This is
 * that missing path: an operator action that resets one stuck item_workflow_state
 * row to `active` and leaves an audit trail.
 *
 * It writes TWO records (per UNIFIED-ENGINE-MASTER-PLAN §1.0):
 *   1. inventory_events NOTE — recovery is a workflow-POSITION reset, not a
 *      serial_status change, so prev/next_status stay null and the detail lives
 *      in the payload. This surfaces "unit was recovered" on the unit timeline.
 *   2. workflow_runs — the append-only engine log, attributed to the node the
 *      unit was parked on, output 'unpark', so the Studio Live/Flow lenses see it.
 *
 * The serial_units.current_status is deliberately UNCHANGED: the domain truth
 * the unit holds is correct; only the engine's position bookkeeping was stuck.
 * After this, the next tap for that unit advances it normally from where it sat.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { emitWorkflowEvent } from './events';

export interface RecoverItemArgs {
  orgId: OrgId;
  serialUnitId: number;
  actorStaffId?: number | null;
  notes?: string | null;
}

export type RecoverItemResult =
  | {
      ok: true;
      serialUnitId: number;
      from: 'blocked' | 'error';
      nodeId: string;
      workflowDefinitionId: number;
    }
  | { ok: false; status: 404 | 409; error: string };

export async function recoverItem(args: RecoverItemArgs): Promise<RecoverItemResult> {
  const outcome = await withTenantTransaction<RecoverItemResult>(args.orgId, async (client) => {
    // 1. Lock the unit's workflow position (tenant-scoped so a cross-org id
    //    reads as not-found). Resolve the parked node's registry type for the
    //    workflow_runs attribution.
    const cur = await client.query<{
      status: string;
      current_node_id: string;
      workflow_definition_id: number;
      node_type: string | null;
    }>(
      `SELECT iws.status,
              iws.current_node_id,
              iws.workflow_definition_id,
              wn.type AS node_type
         FROM item_workflow_state iws
         LEFT JOIN workflow_nodes wn
                ON wn.workflow_definition_id = iws.workflow_definition_id
               AND wn.id = iws.current_node_id
        WHERE iws.organization_id = $1
          AND iws.serial_unit_id = $2
        FOR UPDATE OF iws`,
      [args.orgId, args.serialUnitId],
    );
    const row = cur.rows[0];
    if (!row) {
      return { ok: false, status: 404, error: 'unit is not enrolled in a workflow' };
    }
    if (row.status !== 'blocked' && row.status !== 'error') {
      return {
        ok: false,
        status: 409,
        error: `unit is '${row.status}', not blocked/error — nothing to recover`,
      };
    }
    const from = row.status as 'blocked' | 'error';

    // 2. Reset the position to active. Preserve context (it may hold the last
    //    error message + accumulated node outputs).
    await client.query(
      `UPDATE item_workflow_state
          SET status = 'active', updated_at = NOW()
        WHERE organization_id = $1 AND serial_unit_id = $2`,
      [args.orgId, args.serialUnitId],
    );

    // 3. inventory_events NOTE — timeline visibility. organization_id is stamped
    //    explicitly; we're already inside the tenant tx so the GUC default would
    //    also resolve, but the explicit value is unambiguous.
    await client.query(
      `INSERT INTO inventory_events
         (event_type, actor_staff_id, station, serial_unit_id, notes, payload, organization_id)
       VALUES ('NOTE', $1, 'SYSTEM', $2, $3, $4::jsonb, $5)`,
      [
        args.actorStaffId ?? null,
        args.serialUnitId,
        args.notes ?? null,
        JSON.stringify({ action: 'workflow_recovery', from, to: 'active', nodeId: row.current_node_id }),
        args.orgId,
      ],
    );

    // 4. workflow_runs append-only log, attributed to the parked node.
    await client.query(
      `INSERT INTO workflow_runs
         (organization_id, serial_unit_id, workflow_definition_id, node_type, output, error)
       VALUES ($1, $2, $3, $4, 'unpark', NULL)`,
      [args.orgId, args.serialUnitId, row.workflow_definition_id, row.node_type ?? 'recovery'],
    );

    return {
      ok: true,
      serialUnitId: args.serialUnitId,
      from,
      nodeId: row.current_node_id,
      workflowDefinitionId: row.workflow_definition_id,
    };
  });

  // 5. Best-effort realtime nudge so the Studio Live lens refetches its
  //    blocked/error counts (it never polls — Studio law #4). After the commit,
  //    over neon-http, exactly like the engine's tap-after emit.
  if (outcome.ok) {
    try {
      await emitWorkflowEvent(args.orgId, {
        serialUnitId: outcome.serialUnitId,
        workflowDefinitionId: outcome.workflowDefinitionId,
        nodeType: 'recovery',
        output: 'unpark',
        at: new Date().toISOString(),
        nodeId: outcome.nodeId,
      });
    } catch {
      /* realtime is best-effort — never fail a recovery because Ably hiccupped */
    }
  }

  return outcome;
}
