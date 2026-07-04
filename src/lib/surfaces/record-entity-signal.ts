/**
 * recordEntitySignal — the single writer for entity_signals
 * (docs/todo/universal-feed-polymorphic-plan.md §2.3 / §6).
 *
 * One call = one structured "why" fact + its ops_events emission, written
 * atomically in one tenant transaction (or on the caller's in-flight client
 * when a chokepoint is already inside withTenantTransaction). Validation is
 * app-layer against src/lib/surfaces/registry.ts per the polymorphic contract:
 *   • signal_kind must be registered; entity_type must be registered AND
 *     allowed for that kind;
 *   • external-origin kinds (buyer_note, …) REQUIRE source_ref — idempotency
 *     rides `ON CONFLICT DO NOTHING` against ux_entity_signals_source_ref;
 *   • internal chokepoint kinds must NOT set source_ref — their idempotency
 *     rides the chokepoint's own clientEventId/event gating.
 *
 * Validation failures return `{ ok: false }` (never throw); DB errors
 * propagate — chokepoint call sites go through `emitEntitySignalSafe`, which
 * guarantees a signal failure can never fail the domain action.
 *
 * Deps-injected (default real impls) so unit tests run DB-free.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import {
  SIGNAL_KINDS,
  SURFACE_ENTITY_TYPES,
  isSignalKind,
  isSurfaceEntityType,
  type SignalKind,
  type SurfaceEntityType,
} from './registry';

interface QueryResultLike {
  rows: Array<Record<string, unknown>>;
}

export interface SignalQueryExecutor {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResultLike>;
}

export interface RecordEntitySignalInput {
  organizationId: OrgId;
  entityType: SurfaceEntityType | (string & {});
  entityId: number;
  signalKind: SignalKind | (string & {});
  reasonCode?: string | null;
  notes?: string | null;
  severity?: number | null;
  /** Defaults to now(). */
  occurredAt?: Date | string | null;
  workflowDefinitionId?: number | null;
  nodeId?: string | null;
  /** External natural key — REQUIRED for external-origin kinds, forbidden for internal. */
  sourceRef?: string | null;
  meta?: Record<string, unknown> | null;
  /** Actor stamped on the ops_events emission. */
  actorStaffId?: number | null;
  /**
   * Caller-owned client (already inside withTenantTransaction, GUC set).
   * When present the signal + ops_event ride the caller's transaction;
   * otherwise the helper opens its own tenant transaction.
   */
  client?: SignalQueryExecutor | null;
}

export type RecordEntitySignalResult =
  | { ok: true; id: number; duplicate: false }
  | { ok: true; id: null; duplicate: true }
  | { ok: false; error: string };

export interface RecordEntitySignalDeps {
  runTransaction: <T>(orgId: OrgId, fn: (client: SignalQueryExecutor) => Promise<T>) => Promise<T>;
}

const defaultDeps: RecordEntitySignalDeps = {
  runTransaction: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client)),
};

function validate(input: RecordEntitySignalInput): string | null {
  if (!input.organizationId) return 'organizationId is required';
  if (!isSignalKind(input.signalKind)) return `unknown signal_kind "${input.signalKind}"`;
  if (!isSurfaceEntityType(input.entityType)) return `unknown entity_type "${input.entityType}"`;
  const kind = SIGNAL_KINDS[input.signalKind];
  if (!(kind.entityTypes as readonly string[]).includes(input.entityType)) {
    return `signal_kind "${input.signalKind}" does not anchor on entity_type "${input.entityType}"`;
  }
  if (!Number.isSafeInteger(input.entityId) || input.entityId <= 0) {
    return `invalid entityId ${input.entityId}`;
  }
  const sourceRef = input.sourceRef ?? null;
  if (kind.origin === 'external' && !sourceRef) {
    return `external signal_kind "${input.signalKind}" requires sourceRef for idempotent derivation`;
  }
  if (kind.origin === 'internal' && sourceRef) {
    return `internal signal_kind "${input.signalKind}" must not set sourceRef (idempotency rides the chokepoint)`;
  }
  return null;
}

async function writeSignal(
  client: SignalQueryExecutor,
  input: RecordEntitySignalInput,
): Promise<RecordEntitySignalResult> {
  const occurredAt =
    input.occurredAt instanceof Date ? input.occurredAt.toISOString() : (input.occurredAt ?? null);

  // ON CONFLICT DO NOTHING pairs with ux_entity_signals_source_ref
  // (organization_id, signal_kind, source_ref) WHERE source_ref IS NOT NULL —
  // fresh path, heal sweep and backfills are all free no-ops on rows already
  // emitted (plan §2.3). Internal signals (source_ref NULL) never conflict.
  const inserted = await client.query(
    `INSERT INTO entity_signals (
       organization_id, entity_type, entity_id, signal_kind,
       reason_code, notes, severity, occurred_at,
       workflow_definition_id, node_id, source_ref, meta
     ) VALUES (
       $1::uuid, $2, $3::bigint, $4,
       $5, $6, $7::smallint, COALESCE($8::timestamptz, NOW()),
       $9::int, $10, $11, $12::jsonb
     )
     ON CONFLICT (organization_id, signal_kind, source_ref)
       WHERE source_ref IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      input.organizationId,
      input.entityType,
      input.entityId,
      input.signalKind,
      input.reasonCode ?? null,
      input.notes ?? null,
      input.severity ?? null,
      occurredAt,
      input.workflowDefinitionId ?? null,
      input.nodeId ?? null,
      input.sourceRef ?? null,
      JSON.stringify(input.meta ?? {}),
    ],
  );

  if (inserted.rows.length === 0) {
    return { ok: true, id: null, duplicate: true };
  }
  const id = Number((inserted.rows[0] as { id: number | string }).id);

  // Same-transaction ops_events emission (the event spine stays the SoT
  // timeline; rolls back with the signal if the caller's tx aborts).
  const opsEntityType = SURFACE_ENTITY_TYPES[input.entityType as SurfaceEntityType].opsEventEntityType;
  await client.query(
    `INSERT INTO ops_events (
       organization_id, occurred_at, event_type, entity_type, entity_id,
       actor_staff_id, client_event_id, payload
     ) VALUES (
       $1::uuid, COALESCE($2::timestamptz, NOW()), 'signal_recorded', $3, $4::bigint,
       $5::int, $6, $7::jsonb
     )
     ON CONFLICT (client_event_id) DO NOTHING`,
    [
      input.organizationId,
      occurredAt,
      opsEntityType,
      input.entityId,
      input.actorStaffId ?? null,
      `entity-signal:${id}`,
      JSON.stringify({
        signalId: id,
        signalKind: input.signalKind,
        reasonCode: input.reasonCode ?? null,
        nodeId: input.nodeId ?? null,
      }),
    ],
  );

  return { ok: true, id, duplicate: false };
}

export async function recordEntitySignal(
  input: RecordEntitySignalInput,
  deps: RecordEntitySignalDeps = defaultDeps,
): Promise<RecordEntitySignalResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  if (input.client) {
    // SAVEPOINT guard — a failed signal INSERT inside the CALLER's transaction
    // would otherwise poison it (25P02): every later statement fails and the
    // final COMMIT silently degrades to ROLLBACK, undoing the caller's own
    // domain writes. Rolling back to the savepoint contains the failure so
    // "a signal failure must never fail the domain action" holds even in-tx.
    const client = input.client;
    await client.query('SAVEPOINT entity_signal_emit');
    try {
      const result = await writeSignal(client, input);
      await client.query('RELEASE SAVEPOINT entity_signal_emit');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK TO SAVEPOINT entity_signal_emit');
      } catch {
        // caller's tx was already aborted before our savepoint — nothing to save
      }
      throw err;
    }
  }
  return deps.runTransaction(input.organizationId, (client) => writeSignal(client, input));
}

/**
 * Fire-and-forget wrapper for chokepoint call sites — NEVER throws and never
 * rejects (tapWorkflow semantics): a signal failure must never fail the
 * domain action. Validation failures and DB errors are logged and dropped.
 */
export async function emitEntitySignalSafe(
  input: RecordEntitySignalInput,
  deps: RecordEntitySignalDeps = defaultDeps,
): Promise<void> {
  try {
    const result = await recordEntitySignal(input, deps);
    if (!result.ok) {
      console.warn(`[entity-signal] dropped invalid signal (non-fatal): ${result.error}`);
    }
  } catch (err) {
    console.warn('[entity-signal] write failed (non-fatal):', err);
  }
}
