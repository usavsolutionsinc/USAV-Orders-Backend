/**
 * Granular draft-graph writers for the AI write path (applyAgentMutation
 * draft-scoped kinds; universal-feed plan §2.6 / ops-studio law #6).
 *
 * Every writer:
 *   • runs on a caller-owned tenant client (the applyAgentMutation tx);
 *   • verifies the target definition is a NON-ACTIVE DRAFT owned by the org
 *     (FOR UPDATE) — the active version is never mutated in place;
 *   • returns an `inverse` descriptor so the edit is revertable (the draft is
 *     the safety layer, revert is the undo).
 *
 * These apply the SAME table shape as the Studio wholesale graph-save
 * (workflow_nodes / workflow_edges / workflow_definitions.annotations), but
 * granularly, so one conversational edit = one small mutation, not a full
 * replace. Node-type validity is checked against the engine registry (hasNode)
 * exactly like the save route.
 */

import { hasNode } from '@/lib/workflow';
import { validateNodeConfig } from './validate-config';
import { safeRandomUUID } from '@/lib/safe-uuid';
import type { OrgId } from '@/lib/tenancy/constants';

export interface DraftGraphClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export type DraftGraphInverse = { kind: string; payload: Record<string, unknown> } | null;

export interface DraftGraphResult {
  ok: boolean;
  error?: string;
  status?: 400 | 404 | 409 | 422;
  /** Primary id touched (node id / edge id / definition id) for affects rows. */
  targetRef?: string;
  inverse: DraftGraphInverse;
}

/** Verify the definition exists, belongs to the org, and is an editable draft. */
async function lockDraft(
  client: DraftGraphClient,
  orgId: OrgId,
  definitionId: number,
): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const def = await client.query(
    `SELECT id, is_active FROM workflow_definitions
      WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [orgId, definitionId],
  );
  if (def.rows.length === 0) return { ok: false, status: 404, error: 'definition not found' };
  if (def.rows[0].is_active) {
    return { ok: false, status: 409, error: 'the active version is read-only — edit a draft and publish it' };
  }
  return { ok: true };
}

export async function draftAddNode(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; type: string; x?: number; y?: number; config?: Record<string, unknown>; nodeId?: string },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };
  if (!hasNode(p.type)) return { ok: false, status: 422, error: `unknown node type "${p.type}"`, inverse: null };

  const nodeId = p.nodeId && /^[a-z0-9:_-]+$/i.test(p.nodeId) ? p.nodeId : `n-${safeRandomUUID()}`;
  await client.query(
    `INSERT INTO workflow_nodes (id, workflow_definition_id, type, position_x, position_y, config)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [nodeId, p.definitionId, p.type, p.x ?? 0, p.y ?? 0, JSON.stringify(p.config ?? {})],
  );
  return {
    ok: true,
    targetRef: nodeId,
    inverse: { kind: 'workflow_draft.remove_node', payload: { definitionId: p.definitionId, nodeId } },
  };
}

export async function draftRemoveNode(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; nodeId: string },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };

  const node = await client.query(
    `SELECT id, type, position_x, position_y, config FROM workflow_nodes
      WHERE workflow_definition_id = $1 AND id = $2`,
    [p.definitionId, p.nodeId],
  );
  if (node.rows.length === 0) return { ok: false, status: 404, error: 'node not found in draft', inverse: null };

  const edges = await client.query(
    `SELECT id, source_node, source_port, target_node FROM workflow_edges
      WHERE workflow_definition_id = $1 AND (source_node = $2 OR target_node = $2)`,
    [p.definitionId, p.nodeId],
  );
  await client.query(
    `DELETE FROM workflow_edges WHERE workflow_definition_id = $1 AND (source_node = $2 OR target_node = $2)`,
    [p.definitionId, p.nodeId],
  );
  await client.query(`DELETE FROM workflow_nodes WHERE workflow_definition_id = $1 AND id = $2`, [p.definitionId, p.nodeId]);

  const n = node.rows[0];
  return {
    ok: true,
    targetRef: p.nodeId,
    inverse: {
      kind: 'workflow_draft.restore_node',
      payload: {
        definitionId: p.definitionId,
        node: { id: n.id, type: n.type, x: Number(n.position_x), y: Number(n.position_y), config: n.config ?? {} },
        edges: edges.rows.map((e) => ({
          id: e.id,
          source: e.source_node,
          sourcePort: e.source_port,
          target: e.target_node,
        })),
      },
    },
  };
}

/** Internal inverse of remove_node — re-inserts the node and its edges verbatim. */
export async function draftRestoreNode(
  client: DraftGraphClient,
  orgId: OrgId,
  p: {
    definitionId: number;
    node: { id: string; type: string; x: number; y: number; config: Record<string, unknown> };
    edges: Array<{ id: string; source: string; sourcePort: string; target: string }>;
  },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };
  await client.query(
    `INSERT INTO workflow_nodes (id, workflow_definition_id, type, position_x, position_y, config)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (id) DO NOTHING`,
    [p.node.id, p.definitionId, p.node.type, p.node.x, p.node.y, JSON.stringify(p.node.config ?? {})],
  );
  for (const e of p.edges) {
    await client.query(
      `INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [e.id, p.definitionId, e.source, e.sourcePort, e.target],
    );
  }
  return {
    ok: true,
    targetRef: p.node.id,
    inverse: { kind: 'workflow_draft.remove_node', payload: { definitionId: p.definitionId, nodeId: p.node.id } },
  };
}

export async function draftUpdateNodeConfig(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; nodeId: string; configPatch: Record<string, unknown> },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };
  const cur = await client.query(
    `SELECT type, config FROM workflow_nodes WHERE workflow_definition_id = $1 AND id = $2`,
    [p.definitionId, p.nodeId],
  );
  if (cur.rows.length === 0) return { ok: false, status: 404, error: 'node not found in draft', inverse: null };
  const priorConfig = (cur.rows[0].config ?? {}) as Record<string, unknown>;
  const nextConfig = { ...priorConfig, ...p.configPatch };
  // Govern the jsonb: config must conform to the node type's configSchema.
  const valid = validateNodeConfig(String(cur.rows[0].type), nextConfig);
  if (!valid.ok) {
    return { ok: false, status: 400, error: `invalid node config: ${valid.errors.join('; ')}`, inverse: null };
  }
  await client.query(
    `UPDATE workflow_nodes SET config = $3::jsonb WHERE workflow_definition_id = $1 AND id = $2`,
    [p.definitionId, p.nodeId, JSON.stringify(nextConfig)],
  );
  return {
    ok: true,
    targetRef: p.nodeId,
    // Full prior config as the inverse patch (merge-restores exactly).
    inverse: {
      kind: 'workflow_draft.replace_node_config',
      payload: { definitionId: p.definitionId, nodeId: p.nodeId, config: priorConfig },
    },
  };
}

/** Inverse of update_node_config — replaces the whole config (not a merge). */
export async function draftReplaceNodeConfig(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; nodeId: string; config: Record<string, unknown> },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };
  const cur = await client.query(
    `SELECT type, config FROM workflow_nodes WHERE workflow_definition_id = $1 AND id = $2`,
    [p.definitionId, p.nodeId],
  );
  if (cur.rows.length === 0) return { ok: false, status: 404, error: 'node not found in draft', inverse: null };
  const priorConfig = (cur.rows[0].config ?? {}) as Record<string, unknown>;
  // Govern the jsonb: the replacement config must conform to the type's schema.
  const valid = validateNodeConfig(String(cur.rows[0].type), p.config);
  if (!valid.ok) {
    return { ok: false, status: 400, error: `invalid node config: ${valid.errors.join('; ')}`, inverse: null };
  }
  await client.query(
    `UPDATE workflow_nodes SET config = $3::jsonb WHERE workflow_definition_id = $1 AND id = $2`,
    [p.definitionId, p.nodeId, JSON.stringify(p.config)],
  );
  return {
    ok: true,
    targetRef: p.nodeId,
    inverse: {
      kind: 'workflow_draft.replace_node_config',
      payload: { definitionId: p.definitionId, nodeId: p.nodeId, config: priorConfig },
    },
  };
}

export async function draftAddEdge(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; source: string; sourcePort: string; target: string; edgeId?: string },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };

  // "One port → one target": capture + drop any existing edge from the same
  // (source, sourcePort) so the inverse can restore it too.
  const existing = await client.query(
    `SELECT id, target_node FROM workflow_edges
      WHERE workflow_definition_id = $1 AND source_node = $2 AND source_port = $3`,
    [p.definitionId, p.source, p.sourcePort],
  );
  if (existing.rows.length > 0) {
    await client.query(
      `DELETE FROM workflow_edges WHERE workflow_definition_id = $1 AND source_node = $2 AND source_port = $3`,
      [p.definitionId, p.source, p.sourcePort],
    );
  }

  const edgeId = p.edgeId && /^[a-z0-9:_-]+$/i.test(p.edgeId) ? p.edgeId : `e-${safeRandomUUID()}`;
  await client.query(
    `INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node)
     VALUES ($1, $2, $3, $4, $5)`,
    [edgeId, p.definitionId, p.source, p.sourcePort, p.target],
  );
  return {
    ok: true,
    targetRef: edgeId,
    inverse: {
      kind: 'workflow_draft.remove_edge',
      payload: {
        definitionId: p.definitionId,
        edgeId,
        // restore any edge we displaced
        restore: existing.rows[0]
          ? { id: existing.rows[0].id, source: p.source, sourcePort: p.sourcePort, target: existing.rows[0].target_node }
          : null,
      },
    },
  };
}

export async function draftRemoveEdge(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; edgeId: string; restore?: { id: string; source: string; sourcePort: string; target: string } | null },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };
  const cur = await client.query(
    `SELECT id, source_node, source_port, target_node FROM workflow_edges
      WHERE workflow_definition_id = $1 AND id = $2`,
    [p.definitionId, p.edgeId],
  );
  await client.query(`DELETE FROM workflow_edges WHERE workflow_definition_id = $1 AND id = $2`, [p.definitionId, p.edgeId]);
  if (p.restore) {
    await client.query(
      `INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [p.restore.id, p.definitionId, p.restore.source, p.restore.sourcePort, p.restore.target],
    );
  }
  const e = cur.rows[0];
  return {
    ok: true,
    targetRef: p.edgeId,
    inverse: e
      ? {
          kind: 'workflow_draft.add_edge',
          payload: {
            definitionId: p.definitionId,
            edgeId: p.edgeId,
            source: e.source_node,
            sourcePort: e.source_port,
            target: e.target_node,
          },
        }
      : null,
  };
}

export async function draftSetAnnotations(
  client: DraftGraphClient,
  orgId: OrgId,
  p: { definitionId: number; annotations: unknown[] },
): Promise<DraftGraphResult> {
  const lock = await lockDraft(client, orgId, p.definitionId);
  if (!lock.ok) return { ok: false, status: lock.status, error: lock.error, inverse: null };
  const cur = await client.query(
    `SELECT annotations FROM workflow_definitions WHERE organization_id = $1 AND id = $2`,
    [orgId, p.definitionId],
  );
  const prior = (cur.rows[0]?.annotations ?? []) as unknown[];
  await client.query(
    `UPDATE workflow_definitions SET annotations = $3::jsonb, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2`,
    [orgId, p.definitionId, JSON.stringify(p.annotations)],
  );
  return {
    ok: true,
    targetRef: String(p.definitionId),
    inverse: { kind: 'workflow_draft.set_annotations', payload: { definitionId: p.definitionId, annotations: prior } },
  };
}
