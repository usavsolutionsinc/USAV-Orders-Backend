/**
 * studio/definitions — the draft-copy + publish-flip domain logic, extracted
 * verbatim from the /api/studio/definitions route handlers so it is unit-testable
 * DB-free (Phase C.3). Same pattern as applyTransition / markUnitListed: every
 * collaborator that isn't the raw tx client is INJECTED (real impls by default),
 * so a test passes fakes that capture the SQL calls.
 *
 * CRITICAL invariant: the SQL here is byte-identical to what lived inline in the
 * routes — same statements, same order, same transaction boundaries. The route
 * still owns the `withTenantTransaction(orgId, …)` boundary, the body parse, and
 * the audit; it just calls these helpers inside the tx. Do NOT change the SQL
 * semantics (the version-group FOR UPDATE lock, the node-id re-minting + edge
 * remapping, the single-statement deactivate+activate CTE, the blocking-
 * diagnostics gate, the in-flight guard) — that would change publish behavior.
 *
 * The helpers take the already-org-verified tx `client` (a Pick<PoolClient,
 * 'query'>) so the GUC/transaction lives in the route, exactly as before.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
// NOTE: import getNode/hasNode from the DB-free ./registry, NOT the @/lib/workflow
// barrel — the barrel pulls in the Drizzle store (and thus a live DB handle) at
// load, which would crash the DB-free unit test. The barrel's only extra job is
// registering the built-in node types (import side-effect); the route handler
// statically imports it so the registry is populated by the time the real deps
// run. Tests inject fakes for getNode/hasNode and never touch the registry.
import { getNode, hasNode } from '@/lib/workflow/registry';
import { runDiagnostics, type Diagnostic } from '@/lib/workflow/diagnostics';
import { summarizeStations } from '@/lib/studio/station-diagnostics';
import { STATIONS } from '@/components/admin/workflow/operations-catalog';

type TxClient = Pick<PoolClient, 'query'>;

// ─── Draft copy ──────────────────────────────────────────────────────────────

export interface CopyDefinitionToDraftArgs {
  client: TxClient;
  orgId: OrgId;
  /** workflow_definitions.created_by for the new draft. */
  staffId: number;
  /** Definition to copy; omitted = the org's active definition. */
  sourceId?: number;
}

export type CopyDefinitionToDraftResult =
  | { status: 404; body: { ok: false; error: string } }
  | {
      status: 200;
      body: { ok: true; id: number; version: number };
      audit: { draftId: number; sourceId: number; name: string; version: number };
    };

/** Injectable collaborators for the draft copy (real impls by default; fakes in tests). */
export interface CopyDefinitionToDraftDeps {
  /** Mint a fresh global node/edge id. Defaulted to crypto so tests can make it deterministic. */
  newId: (prefix: 'n' | 'e') => string;
}

const defaultCopyDeps: CopyDefinitionToDraftDeps = {
  newId: (prefix) => `${prefix}-${randomUUID()}`,
};

/**
 * Copies a source definition into the next version number for that name,
 * is_active = FALSE. Node ids are re-minted (global TEXT PKs); edges remapped
 * accordingly. Locks the whole (org, name) version group FOR UPDATE so two
 * concurrent creations can't read the same MAX(version) and collide.
 *
 * SQL moved verbatim from POST /api/studio/definitions/draft.
 */
export async function copyDefinitionToDraft(
  args: CopyDefinitionToDraftArgs,
  deps: CopyDefinitionToDraftDeps = defaultCopyDeps,
): Promise<CopyDefinitionToDraftResult> {
  const { client, orgId, staffId, sourceId } = args;

  const source = await client.query<{ id: number; name: string }>(
    sourceId
      ? `SELECT id, name FROM workflow_definitions
          WHERE organization_id = $1 AND id = $2 FOR UPDATE`
      : `SELECT id, name FROM workflow_definitions
          WHERE organization_id = $1 AND is_active = TRUE
          ORDER BY version DESC LIMIT 1 FOR UPDATE`,
    sourceId ? [orgId, sourceId] : [orgId],
  );
  if (!source.rows[0]) {
    return { status: 404 as const, body: { ok: false, error: 'source definition not found' } };
  }
  const src = source.rows[0];

  // Lock the whole (org, name) version group so two concurrent draft
  // creations can't both read the same MAX(version) and collide on the
  // unique (org, name, version) index.
  await client.query(
    `SELECT id FROM workflow_definitions
      WHERE organization_id = $1 AND name = $2 FOR UPDATE`,
    [orgId, src.name],
  );

  // INSERT...SELECT copies organization_id from the org-verified source row;
  // the copy is additionally fenced to id = $4 (src.id, already org-scoped).
  // `annotations` (the canvas sticky-note layer, Phase E3) rides along verbatim
  // from the source row — it's a definition-row column, so the draft fork copies
  // it like name/organization_id (no per-row re-minting; ids are canvas-local).
  const draft = await client.query<{ id: number; version: number }>(
    `INSERT INTO workflow_definitions (organization_id, name, version, is_active, created_by, annotations)
     SELECT organization_id, name,
            (SELECT MAX(version) + 1 FROM workflow_definitions
              WHERE organization_id = $1 AND name = $2),
            FALSE, $3, annotations
       FROM workflow_definitions WHERE id = $4 AND organization_id = $1
     RETURNING id, version`,
    [orgId, src.name, staffId, src.id],
  );
  const draftId = draft.rows[0].id;

  // Copy nodes with fresh global ids; remap edges through the same map.
  // workflow_nodes / workflow_edges have no org column — the org-verified
  // src.id / draftId definition fks are their tenant scope.
  const nodes = await client.query<{
    id: string;
    type: string;
    position_x: string;
    position_y: string;
    config: unknown;
  }>(
    `SELECT id, type, position_x, position_y, config FROM workflow_nodes WHERE workflow_definition_id = $1`,
    [src.id],
  );
  const idMap = new Map<string, string>(nodes.rows.map((n) => [n.id, deps.newId('n')]));
  for (const n of nodes.rows) {
    await client.query(
      `INSERT INTO workflow_nodes (id, workflow_definition_id, type, position_x, position_y, config)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [idMap.get(n.id), draftId, n.type, n.position_x, n.position_y, n.config],
    );
  }
  const edges = await client.query<{ source_node: string; source_port: string; target_node: string }>(
    `SELECT source_node, source_port, target_node FROM workflow_edges WHERE workflow_definition_id = $1`,
    [src.id],
  );
  for (const e of edges.rows) {
    await client.query(
      `INSERT INTO workflow_edges (id, workflow_definition_id, source_node, source_port, target_node)
       VALUES ($1, $2, $3, $4, $5)`,
      [deps.newId('e'), draftId, idMap.get(e.source_node), e.source_port, idMap.get(e.target_node)],
    );
  }

  return {
    status: 200 as const,
    body: { ok: true, id: draftId, version: draft.rows[0].version },
    audit: { draftId, sourceId: src.id, name: src.name, version: draft.rows[0].version },
  };
}

// ─── Publish flip ────────────────────────────────────────────────────────────

export interface PublishDefinitionArgs {
  client: TxClient;
  orgId: OrgId;
  definitionId: number;
}

export type PublishDefinitionResult =
  | { status: 404; body: { ok: false; error: string } }
  | { status: 200; body: { ok: true; alreadyActive: true; id: number } }
  | { status: 422; body: { ok: false; error: 'PUBLISH_BLOCKED'; diagnostics: Diagnostic[] } }
  | { status: 422; body: { ok: false; error: string } }
  | {
      status: 200;
      body: { ok: true; id: number; version: number };
      audit: { name: string; version: number; nodes: number; edges: number; warnings: number };
    };

/** Injectable collaborators for publish (real impls by default; fakes in tests). */
export interface PublishDefinitionDeps {
  runDiagnostics: typeof runDiagnostics;
  hasNode: typeof hasNode;
  getNode: typeof getNode;
  summarizeStations: typeof summarizeStations;
  /** Operations-catalog station keys — the diagnostics linter's allow-set. */
  stationKeys: Set<string>;
}

const defaultPublishDeps: PublishDefinitionDeps = {
  runDiagnostics,
  hasNode,
  getNode,
  summarizeStations,
  stationKeys: new Set(STATIONS.map((s) => s.key)),
};

/**
 * Atomically activates a draft: lock the definition FOR UPDATE, run BLOCKING
 * diagnostics (abort on any error-severity finding), refuse an empty graph,
 * then flip via the single deactivate+activate CTE. Idempotent: re-publishing
 * the already-active version returns success without a flip.
 *
 * SQL moved verbatim from POST /api/studio/definitions/[id]/publish.
 */
export async function publishDefinition(
  args: PublishDefinitionArgs,
  deps: PublishDefinitionDeps = defaultPublishDeps,
): Promise<PublishDefinitionResult> {
  const { client, orgId, definitionId } = args;

  const def = await client.query<{ id: number; name: string; version: number; is_active: boolean }>(
    `SELECT id, name, version, is_active FROM workflow_definitions
      WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [orgId, definitionId],
  );
  if (!def.rows[0]) {
    return { status: 404 as const, body: { ok: false, error: 'definition not found' } };
  }
  if (def.rows[0].is_active) {
    return { status: 200 as const, body: { ok: true, alreadyActive: true, id: definitionId } };
  }

  // Blocking diagnostics gate — inside the transaction so the rows we
  // lint are exactly the rows that go live. workflow_nodes / workflow_edges
  // have no org column; the org-verified definitionId is their tenant scope.
  const nodes = await client.query<{ id: string; type: string; config: Record<string, unknown> }>(
    `SELECT id, type, config FROM workflow_nodes WHERE workflow_definition_id = $1`,
    [definitionId],
  );
  const edges = await client.query<{ id: string; source_node: string; source_port: string; target_node: string }>(
    `SELECT id, source_node, source_port, target_node FROM workflow_edges WHERE workflow_definition_id = $1`,
    [definitionId],
  );
  // Station composition bound to the draft's nodes — feeds the composition
  // rules so an unmapped required role / dangling action blocks publish too.
  const stationRows = nodes.rows.length
    ? (
        await client.query<{ workflow_node_id: string | null; label: string; config: Record<string, unknown> }>(
          `SELECT workflow_node_id, label, config FROM station_definitions
            WHERE organization_id = $1 AND is_active = TRUE AND workflow_node_id = ANY($2)`,
          [orgId, nodes.rows.map((n) => n.id)],
        )
      ).rows
    : [];
  const diagnostics = deps.runDiagnostics({
    nodes: nodes.rows.map((n) => ({ id: n.id, type: n.type, config: n.config ?? {} })),
    edges: edges.rows.map((e) => ({
      id: e.id,
      source: e.source_node,
      sourcePort: e.source_port,
      target: e.target_node,
    })),
    portsOf: (type) => (deps.hasNode(type) ? deps.getNode(type).outputs.map((o) => o.id) : null),
    stationKeys: deps.stationKeys,
    labelOf: (n) => (deps.hasNode(n.type) ? deps.getNode(n.type).label : n.type),
    stationsByNode: deps.summarizeStations(
      stationRows.map((r) => ({ workflowNodeId: r.workflow_node_id, label: r.label, config: r.config })),
    ),
  });
  const blocking = diagnostics.filter((d) => d.severity === 'error');
  if (blocking.length > 0) {
    return {
      status: 422 as const,
      body: { ok: false, error: 'PUBLISH_BLOCKED', diagnostics: blocking },
    };
  }
  if (nodes.rows.length === 0) {
    return { status: 422 as const, body: { ok: false, error: 'cannot publish an empty graph' } };
  }

  // Deactivate + activate in ONE statement (the stations-publish CTE
  // pattern): two concurrent publishes of different drafts of the same
  // name can't interleave a two-statement flip and leave both active.
  await client.query(
    `WITH deactivated AS (
       UPDATE workflow_definitions
          SET is_active = FALSE, updated_at = NOW()
        WHERE organization_id = $1 AND name = $2 AND is_active = TRUE AND id <> $3
        RETURNING id
     )
     UPDATE workflow_definitions
        SET is_active = TRUE, updated_at = NOW()
      WHERE id = $3 AND organization_id = $1`,
    [orgId, def.rows[0].name, definitionId],
  );

  return {
    status: 200 as const,
    body: { ok: true, id: definitionId, version: def.rows[0].version },
    audit: {
      name: def.rows[0].name,
      version: def.rows[0].version,
      nodes: nodes.rows.length,
      edges: edges.rows.length,
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    },
  };
}
