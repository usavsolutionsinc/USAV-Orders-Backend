/**
 * Surface → Studio workflow-node resolution (ops-events unification, Phase 2).
 *
 * A station surface knows "where in the tenant's own flow" it sits via the
 * org's active `station_definitions` row (`workflow_node_id`, soft-linked to
 * `workflow_nodes.id`) — the same row `resolveSurface` already loads for the
 * legacy/composed render decision. This helper extracts just that node id so
 * event writers (`recordOpsEvent`) can stamp the tenant-customizable "where"
 * axis (`ops_events.workflow_node_id`) without learning about compositions.
 *
 * Contract:
 *   • Best-effort and NEVER throws — a node-resolution failure must never
 *     block a production scan (same fail-open law as tapWorkflow). A failure
 *     resolves to null, which is a valid value (the column is nullable by
 *     design: most orgs have no published binding yet).
 *   • Cached per (org, surface) for 60s on the default-deps path — scan-time
 *     callers are human-paced, but bursts (a PO receive) shouldn't refire the
 *     same indexed point-select. Same TTL/staleness trade as tap.ts's
 *     entryCache: a stale hit just stamps the about-to-be-replaced binding.
 *   • Deps-injectable (pass-through to `resolveSurface`) so unit tests run
 *     DB-free; injected-deps calls bypass the cache.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { resolveSurface, type ResolveSurfaceDeps } from './surface-resolver';
import type { SurfaceKey } from './surface-keys';

const NODE_CACHE_TTL_MS = 60_000;
const nodeCache = new Map<string, { value: string | null; at: number }>();

/**
 * The Studio node the org has bound to this surface, or null when no active
 * `station_definitions` row exists / carries a `workflow_node_id` / the load
 * fails. Callers thread the result straight into `recordOpsEvent`'s optional
 * `workflowNodeId` — null simply omits the "where" annotation.
 */
export async function resolveSurfaceWorkflowNodeId(
  key: SurfaceKey,
  orgId: OrgId,
  deps?: ResolveSurfaceDeps,
): Promise<string | null> {
  const cacheKey = `${orgId}:${key}`;
  if (!deps) {
    const cached = nodeCache.get(cacheKey);
    if (cached && Date.now() - cached.at < NODE_CACHE_TTL_MS) return cached.value;
  }
  try {
    const resolved = await resolveSurface(key, orgId, deps);
    const value = resolved.definition?.workflowNodeId ?? null;
    if (!deps) nodeCache.set(cacheKey, { value, at: Date.now() });
    return value;
  } catch (err) {
    console.warn(`[surface-workflow-node] resolve failed for ${key} (non-fatal):`, err);
    return null;
  }
}
