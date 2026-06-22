/**
 * studio/node-station — the node-scoped station-binding domain logic
 * (Operations Studio Phase D / ST5).
 *
 * The page-bound station builder (/api/stations) keys compositions by
 * (page_key, mode_key) — the screen a sidebar MODE renders. Phase D adds the
 * ORTHOGONAL binding: "this composed station IS the UI for workflow node X",
 * recorded on station_definitions.workflow_node_id. The two axes coexist —
 * node.config.station (department key, drives L0 grouping) is untouched here.
 *
 * Node-bound stations live under a reserved page namespace so they never
 * collide with the page-bound rows:
 *   page_key = 'studio-node'
 *   mode_key = <workflow_node_id>
 * One (org, 'studio-node', nodeId, version) per node, same versioned
 * draft-first + atomic-publish semantics as /api/stations.
 *
 * Same discipline as studio/definitions.ts: every collaborator that isn't the
 * raw tx client is INJECTED (real impls by default) so the helpers unit-test
 * DB-free. The route owns the withTenantTransaction boundary, the body parse,
 * and the audit; these helpers run inside that tx and return a
 * { status, body, audit? } verdict the route maps to HTTP.
 *
 * The SQL mirrors the /api/stations upsert + /api/stations/publish flip
 * (the deactivate+activate CTE) verbatim — do not change its semantics.
 */

import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import type { StationConfig } from '@/lib/stations/contract';
import { validateStationConfig, type StationConfigIssue } from '@/lib/stations/validate';

type TxClient = Pick<PoolClient, 'query'>;

/** The reserved page namespace every node-bound station lives under. */
export const NODE_STATION_PAGE_KEY = 'studio-node';

/** Node-bound mode key is just the workflow node id (one station per node). */
export function nodeStationModeKey(nodeId: string): string {
  return nodeId;
}

interface DraftRow {
  id: number;
  page_key: string;
  mode_key: string;
  label: string;
  workflow_node_id: string | null;
  config: StationConfig;
  version: number;
  is_active: boolean;
  updated_by: number | null;
  updated_at: string;
}

export interface NodeStationApiRow {
  id: number;
  pageKey: string;
  modeKey: string;
  label: string;
  workflowNodeId: string | null;
  config: StationConfig;
  version: number;
  isActive: boolean;
  updatedBy: number | null;
  updatedAt: string;
}

function toApi(row: DraftRow): NodeStationApiRow {
  return {
    id: row.id,
    pageKey: row.page_key,
    modeKey: row.mode_key,
    label: row.label,
    workflowNodeId: row.workflow_node_id,
    config: row.config,
    version: row.version,
    isActive: row.is_active,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

// ─── Draft upsert (bind/edit a node's station) ───────────────────────────────

export interface SaveNodeStationDraftArgs {
  client: TxClient;
  orgId: OrgId;
  nodeId: string;
  label: string;
  config: StationConfig;
  /** station_definitions.updated_by */
  staffId: number;
}

export type SaveNodeStationDraftResult =
  | { status: 422; body: { ok: false; error: 'INVALID_CONFIG'; issues: StationConfigIssue[] } }
  | { status: 500; body: { ok: false; error: string } }
  | {
      status: 200;
      body: { ok: true; draft: NodeStationApiRow };
      audit: { pageKey: string; modeKey: string; version: number; workflowNodeId: string };
    };

/** Injectable collaborators for the draft upsert (real impls by default). */
export interface SaveNodeStationDraftDeps {
  validate: (config: StationConfig) => StationConfigIssue[];
}

const defaultSaveDeps: SaveNodeStationDraftDeps = { validate: validateStationConfig };

/**
 * Upserts a DRAFT station_definition bound to `nodeId` (workflow_node_id),
 * under the reserved ('studio-node', nodeId) namespace. Registry-validates the
 * config first (a config referencing a removed block/source/action never lands),
 * then runs the same single-statement update-in-place-or-insert upsert the
 * /api/stations route uses — a retried save lands on the same draft row.
 */
export async function saveNodeStationDraft(
  args: SaveNodeStationDraftArgs,
  deps: SaveNodeStationDraftDeps = defaultSaveDeps,
): Promise<SaveNodeStationDraftResult> {
  const { client, orgId, nodeId, label, config, staffId } = args;
  const modeKey = nodeStationModeKey(nodeId);

  const issues = deps.validate(config);
  if (issues.length > 0) {
    return { status: 422 as const, body: { ok: false, error: 'INVALID_CONFIG', issues } };
  }

  // One statement, atomic: update the existing newer-than-active draft in
  // place, or insert a new version row (is_active = FALSE). Verbatim from the
  // /api/stations upsert; the upsert IS the idempotency story.
  const { rows } = await client.query<DraftRow>(
    `WITH active AS (
       SELECT COALESCE(MAX(version), 0) AS v
         FROM station_definitions
        WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3 AND is_active
     ),
     existing_draft AS (
       SELECT sd.id
         FROM station_definitions sd, active
        WHERE sd.organization_id = $1 AND sd.page_key = $2 AND sd.mode_key = $3
          AND NOT sd.is_active AND sd.version > active.v
        ORDER BY sd.version DESC
        LIMIT 1
     ),
     updated AS (
       UPDATE station_definitions sd
          SET label = $4, workflow_node_id = $5, config = $6::jsonb,
              updated_by = $7, updated_at = NOW()
         FROM existing_draft d
        WHERE sd.id = d.id
        RETURNING sd.*
     ),
     inserted AS (
       INSERT INTO station_definitions
              (organization_id, page_key, mode_key, label, workflow_node_id,
               config, version, is_active, updated_by)
       SELECT $1, $2, $3, $4, $5, $6::jsonb,
              (SELECT COALESCE(MAX(version), 0) + 1 FROM station_definitions
                WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3),
              FALSE, $7
        WHERE NOT EXISTS (SELECT 1 FROM existing_draft)
       RETURNING *
     )
     SELECT id, page_key, mode_key, label, workflow_node_id, config,
            version, is_active, updated_by, updated_at::text
       FROM updated
     UNION ALL
     SELECT id, page_key, mode_key, label, workflow_node_id, config,
            version, is_active, updated_by, updated_at::text
       FROM inserted`,
    [orgId, NODE_STATION_PAGE_KEY, modeKey, label, nodeId, JSON.stringify(config), staffId],
  );

  const draft = rows[0];
  if (!draft) {
    return { status: 500 as const, body: { ok: false, error: 'Draft upsert produced no row' } };
  }

  return {
    status: 200 as const,
    body: { ok: true, draft: toApi(draft) },
    audit: {
      pageKey: draft.page_key,
      modeKey: draft.mode_key,
      version: draft.version,
      workflowNodeId: nodeId,
    },
  };
}

// ─── Publish flip (activate the node's draft station) ────────────────────────

export interface PublishNodeStationArgs {
  client: TxClient;
  orgId: OrgId;
  /** The draft station_definitions.id to activate. */
  id: number;
  /** station_definitions.updated_by for the activated row. */
  staffId: number;
}

export type PublishNodeStationResult =
  | { status: 404; body: { ok: false; error: string } }
  | { status: 200; body: { ok: true; alreadyActive: true; id: number } }
  | { status: 422; body: { ok: false; error: 'INVALID_CONFIG'; issues: StationConfigIssue[] } }
  | {
      status: 200;
      body: { ok: true; id: number; version: number };
      audit: { pageKey: string; modeKey: string; version: number; workflowNodeId: string | null };
    };

export interface PublishNodeStationDeps {
  validate: (config: StationConfig) => StationConfigIssue[];
}

const defaultPublishDeps: PublishNodeStationDeps = { validate: validateStationConfig };

/**
 * Atomically activates a node-bound draft station: registry-validate the saved
 * config, then deactivate the (org, page, mode) sibling + activate the target in
 * ONE statement (the /api/stations/publish CTE). Idempotent: re-publishing the
 * already-active version is a no-op success.
 */
export async function publishNodeStation(
  args: PublishNodeStationArgs,
  deps: PublishNodeStationDeps = defaultPublishDeps,
): Promise<PublishNodeStationResult> {
  const { client, orgId, id, staffId } = args;

  const target = await client.query<{
    id: number;
    page_key: string;
    mode_key: string;
    version: number;
    is_active: boolean;
    workflow_node_id: string | null;
    config: StationConfig;
  }>(
    `SELECT id, page_key, mode_key, version, is_active, workflow_node_id, config
       FROM station_definitions
      WHERE id = $1 AND organization_id = $2 AND page_key = $3`,
    [id, orgId, NODE_STATION_PAGE_KEY],
  );
  const row = target.rows[0];
  if (!row) {
    return { status: 404 as const, body: { ok: false, error: 'NOT_FOUND' } };
  }
  if (row.is_active) {
    return { status: 200 as const, body: { ok: true, alreadyActive: true, id: row.id } };
  }

  const issues = deps.validate(row.config);
  if (issues.length > 0) {
    return { status: 422 as const, body: { ok: false, error: 'INVALID_CONFIG', issues } };
  }

  const { rows: published } = await client.query<{ id: number; version: number }>(
    `WITH deactivated AS (
       UPDATE station_definitions
          SET is_active = FALSE, updated_at = NOW()
        WHERE organization_id = $2 AND page_key = $3 AND mode_key = $4
          AND is_active AND id <> $1
        RETURNING id
     )
     UPDATE station_definitions
        SET is_active = TRUE, updated_by = $5, updated_at = NOW()
      WHERE id = $1 AND organization_id = $2
      RETURNING id, version`,
    [row.id, orgId, row.page_key, row.mode_key, staffId],
  );

  return {
    status: 200 as const,
    body: { ok: true, id: published[0]?.id ?? row.id, version: row.version },
    audit: {
      pageKey: row.page_key,
      modeKey: row.mode_key,
      version: row.version,
      workflowNodeId: row.workflow_node_id,
    },
  };
}
