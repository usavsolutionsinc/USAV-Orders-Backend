/**
 * Loader for the per-org navigation override (Phase 4). Deps-injected so it
 * unit-tests DB-free (real impl fetches the active `nav_definitions` row). The
 * merge itself lives in the pure `org-nav.ts`; this only reads the row.
 */

import type { OrgId } from '@/lib/tenancy/constants';
import { parseNavDefinition, type NavDefinition } from './org-nav';

export interface LoadOrgNavDeps {
  /** Load the org's active nav_definitions config jsonb, or null when none. */
  loadActiveConfig: (orgId: OrgId) => Promise<unknown | null>;
}

const defaultDeps: LoadOrgNavDeps = {
  loadActiveConfig: async (orgId) => {
    const { tenantQuery } = await import('@/lib/tenancy/db');
    const { rows } = await tenantQuery<{ config: unknown }>(
      orgId,
      `SELECT config FROM nav_definitions
        WHERE organization_id = $1 AND is_active = TRUE
        ORDER BY version DESC LIMIT 1`,
      [orgId],
    );
    return rows[0]?.config ?? null;
  },
};

/** Resolve the org's active nav override (null when none is published). */
export async function loadActiveOrgNav(
  orgId: OrgId,
  deps: LoadOrgNavDeps = defaultDeps,
): Promise<NavDefinition | null> {
  const raw = await deps.loadActiveConfig(orgId);
  return parseNavDefinition(raw);
}
