/**
 * Per-tenant cron fan-out.
 *
 * Background jobs that today run a single global pass must instead iterate every
 * org INSIDE its tenant GUC, so that once RLS is FORCE-enforced (Phase E) each
 * pass only sees that org's rows. Per-org failures are isolated — one bad tenant
 * never aborts the whole sweep.
 *
 * ⚠ TWO-POOL SPLIT (Phase E1): org ENUMERATION must run on a PRIVILEGED
 * connection. Today the app connects as `neondb_owner` (BYPASSRLS), so the
 * shared `pool` enumerates every org fine. After the app moves to the
 * non-bypass `app_tenant` role, this enumeration SELECT must use the
 * admin/owner pool (`ADMIN_DATABASE_URL`) — the tenant role with FORCE on
 * `organizations` would otherwise see only its own row and the sweep would
 * silently collapse to one tenant. Swap `enumerationQuery` to the admin pool
 * when ADMIN_DATABASE_URL lands.
 *
 * See docs/tenancy/multi-tenancy-execution-plan.md §Phase D2.
 */
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { withTenantConnection } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export interface OrgRunResult<T> {
  orgId: OrgId;
  ok: boolean;
  result?: T;
  error?: unknown;
}

/** Enumerate the tenant orgs to sweep. Excludes cancelled orgs; runs on the
 *  privileged pool (see the two-pool note above). */
async function listSweepOrgIds(): Promise<OrgId[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE status <> 'cancelled'`,
  );
  return rows.map((r) => r.id as OrgId);
}

/**
 * Run `fn` once per active org inside that org's tenant connection (GUC set).
 * Returns a per-org result list so callers can log partial failures. Never
 * throws for a single tenant's error — it's captured in the result.
 */
export async function forEachActiveOrg<T>(
  fn: (orgId: OrgId, client: PoolClient) => Promise<T>,
): Promise<OrgRunResult<T>[]> {
  const orgIds = await listSweepOrgIds();
  const results: OrgRunResult<T>[] = [];
  for (const orgId of orgIds) {
    try {
      const result = await withTenantConnection(orgId, (client) => fn(orgId, client));
      results.push({ orgId, ok: true, result });
    } catch (error) {
      console.error(`[forEachActiveOrg] org ${orgId} failed:`, error);
      results.push({ orgId, ok: false, error });
    }
  }
  return results;
}
