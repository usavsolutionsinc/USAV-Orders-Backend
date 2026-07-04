/**
 * applyAgentMutation — the single AI write chokepoint (universal-feed plan
 * §2.6 / §6). Every AI-proposed change flows through here.
 *
 * Trust classes (src/lib/surfaces/registry.ts MUTATION_KINDS, §10 spec):
 *   • auto         — view-layer projection kinds; applied immediately, no
 *                    review (feed_membership.set_state, staff_rail_exclusion.*,
 *                    entity_signal.insert, node_surface.set_config).
 *   • draft_scoped — workflow DRAFT edits; applied immediately to the draft
 *                    (the draft IS the safety layer, publish stays the human
 *                    gate). Revertable.
 *   • review       — masters / live definitions (staff.create, reason_code.*,
 *                    setting.*); NEVER applied here — lands as status='proposed'
 *                    for a human to apply.
 *
 * Every APPLY runs one guarded write + the agent_mutations/affects rows in ONE
 * tenant transaction; recordAudit + ops_event + Ably fire post-commit,
 * best-effort. The inverse descriptor captured on apply drives revert.
 *
 * Deps-injected (default = real impls) so unit tests run DB-free.
 */

import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { recordOpsEvent } from '@/lib/ops-events';
import { publishAssistantMutation } from '@/lib/realtime/publish';

/** recordAudit's first param type (the local Queryable is unexported). */
type AuditDb = Parameters<typeof recordAudit>[0];
import {
  MUTATION_KINDS,
  isMutationKind,
  mutationTrustClass,
  type MutationKind,
  type MutationTrustClass,
} from '@/lib/surfaces/registry';
import {
  createNodeSurface,
  deleteNodeSurface,
  insertStaffRailExclusion,
  deleteStaffRailExclusion,
  setFeedMembershipState,
  setNodeSurfaceConfig,
  type FeedWriteClient,
  type FeedWriteInverse,
} from '@/lib/surfaces/feed-writes';
import { recordEntitySignal } from '@/lib/surfaces/record-entity-signal';
import {
  draftAddEdge,
  draftAddNode,
  draftRemoveEdge,
  draftRemoveNode,
  draftReplaceNodeConfig,
  draftRestoreNode,
  draftSetAnnotations,
  draftUpdateNodeConfig,
  type DraftGraphClient,
  type DraftGraphInverse,
} from '@/lib/workflow/draft-graph-writes';

type Client = FeedWriteClient & DraftGraphClient;
type Payload = Record<string, unknown>;
type Inverse = { kind: string; payload: Payload } | null;

export interface ApplyAgentMutationInput {
  organizationId: OrgId;
  mutationKind: string;
  payload: Payload;
  proposedByStaffId?: number | null;
  aiChatSessionId?: string | null;
}

export type ApplyAgentMutationResult =
  | { ok: true; status: 'applied' | 'proposed'; mutationId: number; trust: MutationTrustClass; targetRef: string | null }
  | { ok: false; status: 400 | 404 | 409; error: string };

export interface AgentMutationSideEffects {
  organizationId: OrgId;
  mutationId: number;
  mutationKind: MutationKind;
  action: string;
  actorStaffId: number | null;
  targetRef: string | null;
  db: AuditDb;
}

export interface ApplyAgentMutationDeps {
  runTransaction: <T>(orgId: OrgId, fn: (client: Client) => Promise<T>) => Promise<T>;
  /** Post-commit audit + ops_event + Ably. Overridable/no-op in tests. */
  sideEffects: (e: AgentMutationSideEffects) => Promise<void>;
}

/** One guarded write per mutation kind → { ok, inverse, targetRef } or an error. */
async function dispatchApply(
  client: Client,
  orgId: OrgId,
  kind: MutationKind,
  payload: Payload,
): Promise<{ ok: true; inverse: Inverse; targetRef: string | null } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const p = payload;
  switch (kind) {
    case 'staff_rail_exclusion.insert': {
      const r = await insertStaffRailExclusion(client, orgId, p as never);
      return r.ok
        ? { ok: true, inverse: r.inverse as Inverse, targetRef: r.entityId != null ? String(r.entityId) : null }
        : { ok: false, status: 400, error: r.error ?? 'invalid' };
    }
    case 'staff_rail_exclusion.delete': {
      const r = await deleteStaffRailExclusion(client, orgId, p as never);
      return r.ok
        ? { ok: true, inverse: r.inverse as Inverse, targetRef: r.entityId != null ? String(r.entityId) : null }
        : { ok: false, status: 400, error: r.error ?? 'invalid' };
    }
    case 'feed_membership.set_state': {
      const r = await setFeedMembershipState(client, orgId, p as never);
      return r.ok
        ? { ok: true, inverse: r.inverse as Inverse, targetRef: r.entityId != null ? String(r.entityId) : null }
        : { ok: false, status: 404, error: r.error ?? 'invalid' };
    }
    case 'entity_signal.insert': {
      // Append-only fact — the signal IS the action, so a validation/DB failure
      // must surface (unlike the fire-and-forget chokepoint taps). The
      // SAVEPOINT inside recordEntitySignal keeps a DB error from poisoning
      // this tx. Never revertable.
      const sig = await recordEntitySignal(
        {
          ...(p as Record<string, unknown>),
          organizationId: orgId,
          client,
        } as unknown as Parameters<typeof recordEntitySignal>[0],
      );
      if (!sig.ok) return { ok: false, status: 400, error: sig.error };
      return { ok: true, inverse: null, targetRef: sig.id != null ? String(sig.id) : null };
    }
    case 'node_surface.set_config': {
      const r = await setNodeSurfaceConfig(client, orgId, p as never);
      return feedToDispatch(r);
    }
    case 'node_surface.create': {
      const r = await createNodeSurface(client, orgId, p as never);
      return feedToDispatch(r);
    }
    case 'node_surface.delete': {
      const r = await deleteNodeSurface(client, orgId, p as never);
      return feedToDispatch(r);
    }
    case 'workflow_draft.add_node':
      return draftToDispatch(await draftAddNode(client, orgId, p as never));
    case 'workflow_draft.remove_node':
      return draftToDispatch(await draftRemoveNode(client, orgId, p as never));
    case 'workflow_draft.restore_node' as MutationKind:
      return draftToDispatch(await draftRestoreNode(client, orgId, p as never));
    case 'workflow_draft.update_node_config':
      return draftToDispatch(await draftUpdateNodeConfig(client, orgId, p as never));
    case 'workflow_draft.replace_node_config' as MutationKind:
      return draftToDispatch(await draftReplaceNodeConfig(client, orgId, p as never));
    case 'workflow_draft.add_edge':
      return draftToDispatch(await draftAddEdge(client, orgId, p as never));
    case 'workflow_draft.remove_edge':
      return draftToDispatch(await draftRemoveEdge(client, orgId, p as never));
    case 'workflow_draft.set_annotations':
      return draftToDispatch(await draftSetAnnotations(client, orgId, p as never));
    default:
      // review-class kinds never reach dispatchApply; anything else is a gap.
      return { ok: false, status: 400, error: `no apply path for mutation kind "${kind}"` };
  }
}

function feedToDispatch(r: { ok: boolean; error?: string; status?: 400 | 404 | 409; inverse: FeedWriteInverse; entityId?: number }) {
  return r.ok
    ? { ok: true as const, inverse: r.inverse as Inverse, targetRef: r.entityId != null ? String(r.entityId) : null }
    : { ok: false as const, status: (r.status ?? 400) as 400 | 404 | 409, error: r.error ?? 'invalid' };
}

function draftToDispatch(r: { ok: boolean; error?: string; status?: 400 | 404 | 409 | 422; inverse: DraftGraphInverse; targetRef?: string }) {
  return r.ok
    ? { ok: true as const, inverse: r.inverse as Inverse, targetRef: r.targetRef ?? null }
    : { ok: false as const, status: (r.status === 422 ? 400 : r.status ?? 400) as 400 | 404 | 409, error: r.error ?? 'invalid' };
}

const defaultDeps: ApplyAgentMutationDeps = {
  runTransaction: (orgId, fn) => withTenantTransaction(orgId, (client) => fn(client as unknown as Client)),
  sideEffects: defaultSideEffects,
};

async function defaultSideEffects(e: AgentMutationSideEffects): Promise<void> {
  try {
    await recordAudit(e.db, null, null, {
      source: 'assistant.mutation',
      action: e.action,
      entityType: AUDIT_ENTITY.AGENT_MUTATION,
      entityId: e.mutationId,
      method: 'system',
      actorStaffIdOverride: e.actorStaffId,
      organizationIdOverride: e.organizationId,
      extra: { mutationKind: e.mutationKind, targetRef: e.targetRef },
    });
  } catch (err) {
    console.warn('[agent-mutation] audit failed (non-fatal):', err);
  }
  try {
    await recordOpsEvent({
      organizationId: e.organizationId,
      entityType: 'other',
      entityId: e.mutationId,
      eventType: e.action,
      actorStaffId: e.actorStaffId,
      clientEventId: `agent-mutation:${e.mutationId}:${e.action}`,
      payload: { mutationKind: e.mutationKind, targetRef: e.targetRef },
    });
  } catch (err) {
    console.warn('[agent-mutation] ops_event failed (non-fatal):', err);
  }
  try {
    await publishAssistantMutation({
      organizationId: e.organizationId,
      mutationId: e.mutationId,
      mutationKind: e.mutationKind,
      action: e.action,
      targetRef: e.targetRef,
    });
  } catch (err) {
    console.warn('[agent-mutation] realtime publish failed (non-fatal):', err);
  }
}

export async function applyAgentMutation(
  input: ApplyAgentMutationInput,
  deps: ApplyAgentMutationDeps = defaultDeps,
): Promise<ApplyAgentMutationResult> {
  if (!input.organizationId) return { ok: false, status: 400, error: 'organizationId is required' };
  if (!isMutationKind(input.mutationKind)) {
    return { ok: false, status: 400, error: `unknown mutation kind "${input.mutationKind}"` };
  }
  const kind = input.mutationKind;
  const trust = mutationTrustClass(kind);
  const payload = input.payload ?? {};
  const actorStaffId = input.proposedByStaffId ?? null;
  const sessionId = input.aiChatSessionId ?? null;

  // ── review-class: propose only, never apply ────────────────────────────────
  if (trust === 'review') {
    const outcome = await deps.runTransaction(input.organizationId, async (client) => {
      const row = await client.query(
        `INSERT INTO agent_mutations
           (organization_id, proposed_by_staff_id, ai_chat_session_id, status, mutation_kind, payload)
         VALUES ($1, $2, $3, 'proposed', $4, $5::jsonb)
         RETURNING id`,
        [input.organizationId, actorStaffId, sessionId, kind, JSON.stringify(payload)],
      );
      const mutationId = Number(row.rows[0].id);
      await insertAffects(client, input.organizationId, mutationId, kind, MUTATION_KINDS[kind].targetKind, null);
      return mutationId;
    });
    await deps.sideEffects({
      organizationId: input.organizationId,
      mutationId: outcome,
      mutationKind: kind,
      action: AUDIT_ACTION.AGENT_MUTATION_PROPOSE,
      actorStaffId,
      targetRef: null,
      db: poolDb(deps),
    });
    return { ok: true, status: 'proposed', mutationId: outcome, trust, targetRef: null };
  }

  // ── auto / draft_scoped: apply in one tx ───────────────────────────────────
  type ApplyOutcome =
    | { failed: ApplyAgentMutationResult & { ok: false } }
    | { failed: null; mutationId: number; targetRef: string | null };
  const outcome: ApplyOutcome = await deps.runTransaction(input.organizationId, async (client): Promise<ApplyOutcome> => {
    const applied = await dispatchApply(client, input.organizationId, kind, payload);
    if (!applied.ok) return { failed: { ok: false, status: applied.status, error: applied.error } };

    const row = await client.query(
      `INSERT INTO agent_mutations
         (organization_id, proposed_by_staff_id, ai_chat_session_id, status, mutation_kind, payload,
          applied_by, applied_at, extra_audit)
       VALUES ($1, $2, $3, 'applied', $4, $5::jsonb, $2, NOW(), $6::jsonb)
       RETURNING id`,
      [
        input.organizationId,
        actorStaffId,
        sessionId,
        kind,
        JSON.stringify(payload),
        JSON.stringify({ inverse: applied.inverse, trust }),
      ],
    );
    const mutationId = Number(row.rows[0].id);
    await insertAffects(client, input.organizationId, mutationId, kind, MUTATION_KINDS[kind].targetKind, applied.targetRef);
    return { failed: null, mutationId, targetRef: applied.targetRef };
  });

  if (outcome.failed) return outcome.failed;

  await deps.sideEffects({
    organizationId: input.organizationId,
    mutationId: outcome.mutationId,
    mutationKind: kind,
    action: AUDIT_ACTION.AGENT_MUTATION_APPLY,
    actorStaffId,
    targetRef: outcome.targetRef,
    db: poolDb(deps),
  });
  return { ok: true, status: 'applied', mutationId: outcome.mutationId, trust, targetRef: outcome.targetRef };
}

// ─── revert ──────────────────────────────────────────────────────────────────

export interface RevertAgentMutationResult {
  ok: boolean;
  status: 200 | 400 | 404 | 409;
  error?: string;
}

export async function revertAgentMutation(
  mutationId: number,
  orgId: OrgId,
  actorStaffId: number | null,
  deps: ApplyAgentMutationDeps = defaultDeps,
): Promise<RevertAgentMutationResult> {
  const outcome = await deps.runTransaction(orgId, async (client) => {
    const row = await client.query(
      `SELECT status, mutation_kind, extra_audit FROM agent_mutations
        WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [orgId, mutationId],
    );
    if (row.rows.length === 0) return { status: 404 as const, error: 'mutation not found' };
    const r = row.rows[0];
    if (r.status !== 'applied') return { status: 409 as const, error: `mutation is ${r.status}, only applied mutations revert` };
    const extra = (r.extra_audit ?? {}) as { inverse?: Inverse };
    const inverse = extra.inverse ?? null;
    if (!inverse) return { status: 409 as const, error: 'this mutation is not revertable (append-only or missing inverse)' };

    if (!isMutationKind(inverse.kind) && !inverse.kind.startsWith('workflow_draft.')) {
      return { status: 400 as const, error: `unknown inverse kind "${inverse.kind}"` };
    }
    const applied = await dispatchApply(client, orgId, inverse.kind as MutationKind, inverse.payload);
    if (!applied.ok) return { status: applied.status, error: applied.error };

    await client.query(
      `UPDATE agent_mutations SET status = 'reverted', updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
      [orgId, mutationId],
    );
    // Carry the ORIGINAL mutation's kind out so the side-effects (audit / ops /
    // Ably) classify the revert by what was reverted, not by the inverse.
    const revertedKind = isMutationKind(String(r.mutation_kind))
      ? (String(r.mutation_kind) as MutationKind)
      : null;
    return { status: 200 as const, mutationKind: revertedKind };
  });

  if (outcome.status === 200) {
    await deps.sideEffects({
      organizationId: orgId,
      mutationId,
      mutationKind: outcome.mutationKind ?? 'entity_signal.insert',
      action: AUDIT_ACTION.AGENT_MUTATION_REVERT,
      actorStaffId,
      targetRef: null,
      db: poolDb(deps),
    });
  }
  return { ok: outcome.status === 200, status: outcome.status, error: outcome.error };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function insertAffects(
  client: Client,
  orgId: OrgId,
  mutationId: number,
  kind: MutationKind,
  targetKind: string,
  targetRef: string | null,
): Promise<void> {
  if (!targetRef) return;
  await client.query(
    `INSERT INTO agent_mutation_affects (organization_id, agent_mutation_id, target_kind, target_ref, role_in_mutation)
     VALUES ($1, $2, $3, $4, 'primary')`,
    [orgId, mutationId, targetKind, `${targetKind}:entity:${targetRef}`],
  );
}

// The default sideEffects needs an audit db for recordAudit; the real one is
// the shared pool. Tests inject their own sideEffects and never call this.
function poolDb(deps: ApplyAgentMutationDeps): AuditDb {
  if (deps.sideEffects !== defaultSideEffects) {
    // Test path — sideEffects is overridden and won't touch db.
    return {} as AuditDb;
  }
  return (require('@/lib/db') as { default: AuditDb }).default;
}
