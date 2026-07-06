/**
 * Surface resolver — given a surface key + an org, decide whether to render the
 * surface from a published `station_definitions` composition or fall back to the
 * hard-coded legacy tree (the `'legacy'` escape hatch every migrated surface
 * keeps until data parity).
 *
 * The DECISION is pure and DB-free (`decideSurfaceRender`) so it is unit-tested
 * without a database. The LOAD is a thin injectable wrapper (`resolveSurface`)
 * that defaults to the real `tenantQuery` but takes fakes in tests — the same
 * `Deps`-injection contract as applyTransition / studio/definitions.
 *
 * Phase 0 ships the resolver as the foundation; the production render host that
 * consumes a `'composed'` result is Phase 3a. Until an org publishes a real
 * composition for a surface, every resolve returns `'legacy'`, so wiring this in
 * is a no-op for behavior — exactly the safe-by-default cutover the plan wants.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import type { StationConfig, StationDefinitionRow } from './contract';
import type { ArchetypeId } from './archetype';
import { getSurface, type SurfaceDefinition, type SurfaceKey } from './surface-keys';

/** How a surface should be rendered for this org, right now. */
export interface ResolvedSurface {
  key: SurfaceKey;
  surface: SurfaceDefinition;
  archetype: ArchetypeId;
  /**
   * `'legacy'` → render the original hard-coded component tree.
   * `'composed'` → render via the SurfaceRenderer from `definition.config`.
   */
  render: 'legacy' | 'composed';
  /** The active published composition, when one exists (else null). */
  definition: StationDefinitionRow | null;
}

/** True when a config explicitly opts into the hard-coded tree. */
function isLegacyConfig(config: StationConfig | null | undefined): boolean {
  return !config || config.slots === 'legacy';
}

/**
 * Pure decision: given the surface's static definition and the org's active
 * `station_definitions` row (or null), decide legacy-vs-composed. Composed only
 * when there is an active row whose config is a real slot map (not `'legacy'`).
 */
export function decideSurfaceRender(
  surface: SurfaceDefinition,
  activeRow: StationDefinitionRow | null,
): ResolvedSurface {
  const composed = activeRow != null && activeRow.isActive && !isLegacyConfig(activeRow.config);
  return {
    key: surface.key,
    surface,
    archetype: surface.archetype,
    render: composed ? 'composed' : 'legacy',
    definition: activeRow,
  };
}

/** Injectable collaborators (real impls by default; fakes in tests). */
export interface ResolveSurfaceDeps {
  /**
   * Load the active `station_definitions` row for (orgId, pageKey, modeKey), or
   * null when none is published. Defaults to a tenant-scoped SELECT.
   */
  loadActiveDefinition: (
    orgId: OrgId,
    pageKey: string,
    modeKey: string,
  ) => Promise<StationDefinitionRow | null>;
}

interface DefinitionDbRow {
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

function toDefinitionRow(row: DefinitionDbRow): StationDefinitionRow {
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

const defaultDeps: ResolveSurfaceDeps = {
  loadActiveDefinition: async (orgId, pageKey, modeKey) => {
    // Deferred import so the DB-free unit path (fakes) never pulls a live
    // handle at module load — same guard as studio/definitions.ts.
    const { tenantQuery } = await import('@/lib/tenancy/db');
    const { rows } = await tenantQuery<DefinitionDbRow>(
      orgId,
      `SELECT id, page_key, mode_key, label, workflow_node_id, config,
              version, is_active, updated_by, updated_at::text
         FROM station_definitions
        WHERE organization_id = $1 AND page_key = $2 AND mode_key = $3 AND is_active = TRUE
        ORDER BY version DESC
        LIMIT 1`,
      [orgId, pageKey, modeKey],
    );
    return rows[0] ? toDefinitionRow(rows[0]) : null;
  },
};

/**
 * Resolve how to render `key` for `orgId`. Loads the active composition and
 * runs the pure decision. Returns `'legacy'` whenever nothing is published or
 * the active config opts into the hatch — the safe default.
 */
export async function resolveSurface(
  key: SurfaceKey,
  orgId: OrgId,
  deps: ResolveSurfaceDeps = defaultDeps,
): Promise<ResolvedSurface> {
  const surface = getSurface(key);
  const activeRow = await deps.loadActiveDefinition(orgId, surface.pageKey, surface.modeKey);
  return decideSurfaceRender(surface, activeRow);
}
