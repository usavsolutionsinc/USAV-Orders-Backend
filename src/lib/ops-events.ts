import pool from '@/lib/db';

/**
 * The `ops_events.entity_type` vocabulary — code source of truth.
 *
 * This is the deploy-time-fixed "what business object" axis (contrast with the
 * tenant-customizable "where in the flow" axis, `workflow_node_id`). It is the
 * UNION of every entity_type actually written to ops_events today (Phase 0
 * audit, docs/todo/ops-events-station-workflow-unification-plan.md):
 *   • this file's own writer (recordOpsEvent): receiving / receiving_line /
 *     serial_unit / shipment / other;
 *   • recordEntitySignal's direct emission (src/lib/surfaces/record-entity-signal.ts),
 *     which writes SURFACE_ENTITY_TYPES[*].opsEventEntityType: adds order /
 *     fba_shipment / repair / warranty_claim.
 *
 * The migration `2026-07-06_ops_events_entity_type_chk_and_workflow_node.sql`
 * CHECK is pinned byte-for-byte against this array in `ops-events.test.ts`, and
 * that test also asserts every registry opsEventEntityType is covered here — so
 * the DB CHECK and this code list can never drift. Adding a value = extend this
 * array + the CHECK (new migration) in the same PR.
 */
export const OPS_EVENT_ENTITY_TYPES = [
  'receiving',
  'receiving_line',
  'serial_unit',
  'shipment',
  'order',
  'fba_shipment',
  'repair',
  'warranty_claim',
  'other',
] as const;

export type OpsEntityType = (typeof OPS_EVENT_ENTITY_TYPES)[number];

export interface RecordOpsEventInput {
  organizationId: string;
  entityType: OpsEntityType;
  entityId: number;
  eventType: string;
  occurredAt?: string | null;
  actorStaffId?: number | null;
  clientEventId?: string | null;
  /**
   * Optional: WHERE in the tenant's own Studio flow this event happened
   * (workflow_nodes.id — the runtime-created, per-org, zero-deploy id space).
   * Additive per the plan's Phase 2: callers running inside a Studio-composed
   * station thread it through; the (currently many) callers with no node in
   * scope simply omit it. FK-free TEXT on the DB side — see the column comment
   * in the 2026-07-06 migration.
   */
  workflowNodeId?: string | null;
  payload?: unknown;
}

/**
 * Append-only polymorphic ops event log write. Idempotent on client_event_id.
 * This is the "SAL-style" event spine for stable ordering (first scan, unboxed, etc.).
 */
export async function recordOpsEvent(input: RecordOpsEventInput): Promise<void> {
  const occurredAt = input.occurredAt ?? null;
  const actorStaffId = input.actorStaffId ?? null;
  const clientEventId = input.clientEventId ?? null;
  const workflowNodeId = input.workflowNodeId ?? null;
  const payload = input.payload ?? {};

  await pool.query(
    `INSERT INTO ops_events (
       organization_id, occurred_at, event_type,
       entity_type, entity_id,
       actor_staff_id, client_event_id, workflow_node_id, payload
     )
     VALUES (
       $1::uuid,
       COALESCE($2::timestamptz, NOW()),
       $3,
       $4,
       $5::bigint,
       $6::int,
       $7,
       $8,
       $9::jsonb
     )
     ON CONFLICT (client_event_id) DO NOTHING`,
    [
      input.organizationId,
      occurredAt,
      input.eventType,
      input.entityType,
      input.entityId,
      actorStaffId,
      clientEventId,
      workflowNodeId,
      JSON.stringify(payload),
    ],
  );
}
