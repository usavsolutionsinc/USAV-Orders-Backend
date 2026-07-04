/**
 * Guarded write helpers for the view-layer projection tables the AI write
 * path (applyAgentMutation) auto-applies to — feed_memberships,
 * staff_rail_exclusions, node_surfaces (universal-feed plan §2.6 trust list).
 *
 * These are the FIRST writers for these Phase-0 tables (Phase 4 will grow
 * richer sync helpers on top). Each runs on a caller-owned tenant client (the
 * applyAgentMutation transaction) — org is stamped explicitly, and every
 * helper returns a small `inverse` descriptor so the mutation is revertable.
 *
 * Registry-validated, pure-ish (no imports beyond the registry + types) so
 * they unit-test DB-free through a fake client.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import {
  FEED_MEMBERSHIP_STATES,
  isFeedKey,
  isSurfaceEntityType,
  type FeedMembershipState,
} from './registry';

export interface FeedWriteClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export type FeedWriteInverse =
  | { kind: 'staff_rail_exclusion.delete'; payload: Record<string, unknown> }
  | { kind: 'staff_rail_exclusion.insert'; payload: Record<string, unknown> }
  | { kind: 'feed_membership.set_state'; payload: Record<string, unknown> }
  | { kind: 'node_surface.set_config'; payload: Record<string, unknown> }
  | { kind: 'node_surface.delete'; payload: Record<string, unknown> }
  | { kind: 'node_surface.create'; payload: Record<string, unknown> }
  | null;

export interface FeedWriteResult {
  ok: boolean;
  error?: string;
  /** HTTP-ish status for the caller to map (404 not found / 409 conflict / 400 invalid). */
  status?: 400 | 404 | 409;
  /** Descriptor the revert path replays to undo this write (null = not revertable). */
  inverse: FeedWriteInverse;
  /** Canonical entity id touched (for affects rows). */
  entityId?: number;
}

function requireInt(v: unknown, name: string): number | { error: string } {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return { error: `${name} must be a positive integer` };
  return v;
}

// ─── staff_rail_exclusions ───────────────────────────────────────────────────

export async function insertStaffRailExclusion(
  client: FeedWriteClient,
  orgId: OrgId,
  p: { staffId: number; station: string; feedKey: string; entityType: string; entityId: number },
): Promise<FeedWriteResult> {
  if (!isFeedKey(p.feedKey)) return { ok: false, error: `unknown feed_key "${p.feedKey}"`, inverse: null };
  if (!isSurfaceEntityType(p.entityType)) return { ok: false, error: `unknown entity_type "${p.entityType}"`, inverse: null };
  const staff = requireInt(p.staffId, 'staffId');
  if (typeof staff !== 'number') return { ok: false, error: staff.error, inverse: null };
  const entity = requireInt(p.entityId, 'entityId');
  if (typeof entity !== 'number') return { ok: false, error: entity.error, inverse: null };

  await client.query(
    `INSERT INTO staff_rail_exclusions (organization_id, staff_id, station, feed_key, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, staff_id, station, feed_key, entity_type, entity_id) DO NOTHING`,
    [orgId, staff, p.station, p.feedKey, p.entityType, entity],
  );
  return { ok: true, entityId: entity, inverse: { kind: 'staff_rail_exclusion.delete', payload: { ...p } } };
}

export async function deleteStaffRailExclusion(
  client: FeedWriteClient,
  orgId: OrgId,
  p: { staffId: number; station: string; feedKey: string; entityType: string; entityId: number },
): Promise<FeedWriteResult> {
  const entity = requireInt(p.entityId, 'entityId');
  if (typeof entity !== 'number') return { ok: false, error: entity.error, inverse: null };
  await client.query(
    `DELETE FROM staff_rail_exclusions
      WHERE organization_id = $1 AND staff_id = $2 AND station = $3
        AND feed_key = $4 AND entity_type = $5 AND entity_id = $6`,
    [orgId, p.staffId, p.station, p.feedKey, p.entityType, entity],
  );
  return { ok: true, entityId: entity, inverse: { kind: 'staff_rail_exclusion.insert', payload: { ...p } } };
}

// ─── feed_memberships.state ──────────────────────────────────────────────────

export async function setFeedMembershipState(
  client: FeedWriteClient,
  orgId: OrgId,
  p: { feedKey: string; entityType: string; entityId: number; state: string },
): Promise<FeedWriteResult> {
  if (!isFeedKey(p.feedKey)) return { ok: false, error: `unknown feed_key "${p.feedKey}"`, inverse: null };
  if (!isSurfaceEntityType(p.entityType)) return { ok: false, error: `unknown entity_type "${p.entityType}"`, inverse: null };
  if (!(FEED_MEMBERSHIP_STATES as readonly string[]).includes(p.state)) {
    return { ok: false, error: `invalid state "${p.state}"`, inverse: null };
  }
  const entity = requireInt(p.entityId, 'entityId');
  if (typeof entity !== 'number') return { ok: false, error: entity.error, inverse: null };

  const prior = await client.query(
    `SELECT state FROM feed_memberships
      WHERE organization_id = $1 AND feed_key = $2 AND entity_type = $3 AND entity_id = $4
      LIMIT 1`,
    [orgId, p.feedKey, p.entityType, entity],
  );
  if (prior.rows.length === 0) {
    return { ok: false, error: 'feed membership not found (projection layer creates rows, not this mutation)', inverse: null };
  }
  const priorState = String(prior.rows[0].state) as FeedMembershipState;

  await client.query(
    `UPDATE feed_memberships SET state = $5, updated_at = NOW()
      WHERE organization_id = $1 AND feed_key = $2 AND entity_type = $3 AND entity_id = $4`,
    [orgId, p.feedKey, p.entityType, entity, p.state],
  );
  return {
    ok: true,
    entityId: entity,
    inverse: { kind: 'feed_membership.set_state', payload: { ...p, state: priorState } },
  };
}

// ─── node_surfaces ───────────────────────────────────────────────────────────

export async function setNodeSurfaceConfig(
  client: FeedWriteClient,
  orgId: OrgId,
  p: { nodeSurfaceId: number; configPatch: Record<string, unknown> },
): Promise<FeedWriteResult> {
  const id = requireInt(p.nodeSurfaceId, 'nodeSurfaceId');
  if (typeof id !== 'number') return { ok: false, error: id.error, inverse: null };
  const prior = await client.query(
    `SELECT config FROM node_surfaces WHERE organization_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id],
  );
  if (prior.rows.length === 0) return { ok: false, error: 'node surface not found', status: 404, inverse: null };
  const priorConfig = (prior.rows[0].config ?? {}) as Record<string, unknown>;
  const nextConfig = { ...priorConfig, ...p.configPatch };
  await client.query(
    `UPDATE node_surfaces SET config = $3::jsonb, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, id, JSON.stringify(nextConfig)],
  );
  return {
    ok: true,
    entityId: id,
    inverse: { kind: 'node_surface.set_config', payload: { nodeSurfaceId: id, configPatch: priorConfig } },
  };
}

/**
 * A node surface belongs to a workflow definition, and node_surfaces' FK to
 * workflow_definitions is NOT org-composite (FK checks bypass RLS). So verify
 * BOTH ownership and draft-status before writing one — otherwise the AI could
 * declare a surface on another org's definition, or on the ACTIVE version
 * (bypassing the publish gate). Same shape as draftGraph's lockDraft.
 */
async function lockOwnedDraft(
  client: FeedWriteClient,
  orgId: OrgId,
  definitionId: number,
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const def = await client.query(
    `SELECT is_active FROM workflow_definitions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [orgId, definitionId],
  );
  if (def.rows.length === 0) return { ok: false, status: 404, error: 'definition not found' };
  if (def.rows[0].is_active) {
    return { ok: false, status: 409, error: 'the active version is read-only — edit a draft and publish it' };
  }
  return { ok: true };
}

export async function createNodeSurface(
  client: FeedWriteClient,
  orgId: OrgId,
  p: { definitionId: number; nodeId: string; feedKey: string; role?: string; config?: Record<string, unknown> },
): Promise<FeedWriteResult> {
  if (!isFeedKey(p.feedKey)) return { ok: false, error: `unknown feed_key "${p.feedKey}"`, inverse: null };
  const defId = requireInt(p.definitionId, 'definitionId');
  if (typeof defId !== 'number') return { ok: false, error: defId.error, inverse: null };
  const lock = await lockOwnedDraft(client, orgId, defId);
  if (!lock.ok) return { ok: false, error: lock.error, status: lock.status, inverse: null };
  const r = await client.query(
    `INSERT INTO node_surfaces (organization_id, workflow_definition_id, node_id, feed_key, role, config)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (organization_id, workflow_definition_id, node_id, feed_key) DO NOTHING
     RETURNING id`,
    [orgId, defId, p.nodeId, p.feedKey, p.role ?? 'inbox', JSON.stringify(p.config ?? {})],
  );
  if (r.rows.length === 0) return { ok: false, error: 'node surface already exists for this (node, feed)', status: 409, inverse: null };
  const id = Number(r.rows[0].id);
  return { ok: true, entityId: id, inverse: { kind: 'node_surface.delete', payload: { nodeSurfaceId: id } } };
}

export async function deleteNodeSurface(
  client: FeedWriteClient,
  orgId: OrgId,
  p: { nodeSurfaceId: number },
): Promise<FeedWriteResult> {
  const id = requireInt(p.nodeSurfaceId, 'nodeSurfaceId');
  if (typeof id !== 'number') return { ok: false, error: id.error, inverse: null };
  // Refuse to delete a surface whose owning definition is the ACTIVE version
  // (publish-gate bypass) — resolve + lock it first. Org-scoped both ways.
  const owner = await client.query(
    `SELECT wd.is_active FROM node_surfaces ns
       JOIN workflow_definitions wd ON wd.id = ns.workflow_definition_id
      WHERE ns.organization_id = $1 AND ns.id = $2 FOR UPDATE OF wd`,
    [orgId, id],
  );
  if (owner.rows.length === 0) return { ok: false, error: 'node surface not found', status: 404, inverse: null };
  if (owner.rows[0].is_active) {
    return { ok: false, error: 'that surface is on the active version — edit a draft and publish it', status: 409, inverse: null };
  }
  const prior = await client.query(
    `DELETE FROM node_surfaces WHERE organization_id = $1 AND id = $2
     RETURNING workflow_definition_id, node_id, feed_key, role, config`,
    [orgId, id],
  );
  if (prior.rows.length === 0) return { ok: false, error: 'node surface not found', status: 404, inverse: null };
  const row = prior.rows[0];
  return {
    ok: true,
    entityId: id,
    inverse: {
      kind: 'node_surface.create',
      payload: {
        definitionId: Number(row.workflow_definition_id),
        nodeId: String(row.node_id),
        feedKey: String(row.feed_key),
        role: String(row.role),
        config: (row.config ?? {}) as Record<string, unknown>,
      },
    },
  };
}
