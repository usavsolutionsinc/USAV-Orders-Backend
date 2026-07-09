/**
 * Template → surface seeding (operator-surfaces refactor Phase 5). When a
 * workflow template is imported (createDraftFromTemplate), the surfaces its
 * process steps imply should be seeded too — "templates seed both workflow
 * graphs and associated UI surfaces". The join is the surface registry's
 * `workflowNodeType`: a template node of type 'receiving' implies the receiving
 * surfaces (unbox/triage/incoming/pickup/history), a 'fulfillment' node implies
 * pack/outbound, etc.
 *
 * This module is the PURE core (DB-free, unit-tested): given the template's
 * nodes + the createDraftFromTemplate id-remap, it produces the station seeds to
 * bind. The DB insert is a thin composable step (`seedTemplateSurfaces`) the
 * import route can call alongside the guarded createDraftFromTemplate — it never
 * modifies that byte-identical function.
 */

import type { PoolClient } from 'pg';
import type { OrgId } from '@/lib/tenancy/constants';
import { listSurfaces } from '@/lib/stations/surface-keys';
import type { TemplateGraphNode } from './templates';

type TxClient = Pick<PoolClient, 'query'>;

export interface TemplateSurfaceSeed {
  surfaceKey: string;
  pageKey: string;
  modeKey: string;
  /** The re-minted workflow node id this surface binds to. */
  workflowNodeId: string;
  label: string;
}

/**
 * For each template node whose `type` a surface binds to (via
 * `SURFACE_REGISTRY.workflowNodeType`), produce a seed binding that surface to
 * the node's RE-MINTED id (from the createDraftFromTemplate id map). Nodes not in
 * the id map are skipped (a malformed template can't smuggle an unmapped id).
 * Deduped by (pageKey, modeKey) so two nodes of the same type don't double-seed
 * the same surface — the first node wins the binding.
 */
export function buildTemplateSurfaceSeeds(
  nodes: readonly TemplateGraphNode[],
  idMap: ReadonlyMap<string, string>,
): TemplateSurfaceSeed[] {
  // node type → the surfaces that bind to it.
  const surfacesByNodeType = new Map<string, ReturnType<typeof listSurfaces>>();
  for (const s of listSurfaces()) {
    if (!s.workflowNodeType) continue;
    const list = surfacesByNodeType.get(s.workflowNodeType) ?? [];
    list.push(s);
    surfacesByNodeType.set(s.workflowNodeType, list);
  }

  const seeds: TemplateSurfaceSeed[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const surfaces = surfacesByNodeType.get(n.type);
    if (!surfaces) continue;
    const remintedId = idMap.get(n.id);
    if (!remintedId) continue;
    for (const s of surfaces) {
      const key = `${s.pageKey}::${s.modeKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seeds.push({
        surfaceKey: s.key,
        pageKey: s.pageKey,
        modeKey: s.modeKey,
        workflowNodeId: remintedId,
        label: s.label,
      });
    }
  }
  return seeds;
}

/**
 * Persist the surface seeds as node-bound `station_definitions` DRAFT rows
 * (is_active = FALSE, config = the `'legacy'` hatch so nothing renders through
 * the composition yet). The rows bind each surface to the imported node so the
 * owner can compose them from the Studio; publishing is a separate explicit
 * step. Idempotent per (org, page_key, mode_key, node): re-importing won't spam
 * drafts. Takes the already-org-verified tx client (the route owns the
 * withTenantTransaction boundary), mirroring createDraftFromTemplate.
 */
export async function seedTemplateSurfaces(
  client: TxClient,
  orgId: OrgId,
  staffId: number,
  seeds: readonly TemplateSurfaceSeed[],
): Promise<number> {
  let inserted = 0;
  for (const seed of seeds) {
    const res = await client.query<{ id: number }>(
      `INSERT INTO station_definitions
         (organization_id, page_key, mode_key, label, workflow_node_id, config, version, is_active, updated_by)
       SELECT $1, $2, $3, $4, $5, '{"slots":"legacy"}'::jsonb,
              (SELECT COALESCE(MAX(version), 0) + 1 FROM station_definitions
                WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3),
              FALSE, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM station_definitions
          WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3 AND workflow_node_id = $5
       )
       RETURNING id`,
      [orgId, seed.pageKey, seed.modeKey, seed.label, seed.workflowNodeId, staffId],
    );
    if (res.rows[0]) inserted += 1;
  }
  return inserted;
}
