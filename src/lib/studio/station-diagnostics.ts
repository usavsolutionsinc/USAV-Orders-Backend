/**
 * Station composition → diagnostics summaries (Operations Studio, PR #5).
 *
 * Bridges the stations REGISTRY (code) to the pure workflow diagnostics linter:
 * given the active station_definitions rows bound to a graph's nodes, it
 * resolves each block instance's required roles + referenced actions against
 * the registry and emits a per-node `NodeStationSummary`. `runDiagnostics` then
 * turns gaps (unmapped required role, dangling action) into publish-blocking
 * `error` diagnostics — without diagnostics.ts ever importing the registry, so
 * that module stays pure and client-safe.
 *
 * The DB fetch is the caller's job (Drizzle in the graph feed, pg in the
 * publish txn); this resolver is pure and unit-testable.
 */

import { listActionMeta, listBlockMeta, type BlockInstanceConfig } from '@/lib/stations';
import type { NodeStationSummary } from '@/lib/workflow/diagnostics';

export interface StationDefinitionRowLike {
  workflowNodeId: string | null;
  label: string;
  /** station_definitions.config (jsonb): { slots: {slotId: BlockInstanceConfig[]} | 'legacy' }. */
  config: unknown;
}

export function summarizeStations(
  rows: ReadonlyArray<StationDefinitionRowLike>,
): Map<string, NodeStationSummary> {
  const blockMeta = new Map(listBlockMeta().map((b) => [b.type, b]));
  const knownActions = new Set(listActionMeta().map((a) => a.id));
  const byNode = new Map<string, NodeStationSummary>();

  for (const row of rows) {
    if (!row.workflowNodeId) continue;
    const cfg = (row.config ?? {}) as { slots?: Record<string, BlockInstanceConfig[]> | 'legacy' };
    const legacy = cfg.slots === 'legacy';
    const slots = legacy || !cfg.slots ? null : (cfg.slots as Record<string, BlockInstanceConfig[]>);

    const blocks = slots
      ? Object.values(slots)
          .flat()
          .map((b) => {
            const meta = blockMeta.get(b.block) ?? null;
            return {
              blockLabel: meta?.label ?? b.block,
              requiredRoles: (meta?.roles ?? []).filter((r) => r.required).map((r) => r.key),
              mappedRoles: Object.keys(b.source?.fields ?? {}),
              unknownActions: (b.actions ?? []).filter((id) => !knownActions.has(id)),
            };
          })
      : [];

    byNode.set(row.workflowNodeId, { label: row.label, legacy, blocks });
  }

  return byNode;
}
