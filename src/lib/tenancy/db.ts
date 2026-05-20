/**
 * Tenant-scoped DB helper.
 *
 * Every request that touches business data should run inside
 * `withTenantConnection(orgId, fn)`. The wrapper checks out a client from
 * the shared pool, sets `app.current_org` as a session GUC, runs the work,
 * and releases the client.
 *
 * The GUC is the hook that future Row-Level Security policies bind against
 * — once policies land, every table's `organization_id = current_setting
 * ('app.current_org')::uuid` policy becomes a backstop against handlers
 * that forget to filter explicitly. RLS isn't enforced yet (the business
 * tables don't have organization_id columns), but the plumbing here means
 * the day we turn it on, every code path is already running with the
 * setting populated.
 *
 * Usage:
 *   await withTenantConnection(orgId, async (client) => {
 *     const { rows } = await client.query('SELECT * FROM orders');
 *     return rows;
 *   });
 *
 * For one-off queries that don't need a dedicated client, prefer
 * `tenantQuery(orgId, sql, params)` which handles checkout/release for you.
 */

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import pool from '@/lib/db';
import { USAV_ORG_ID, type OrgId } from './constants';

function assertOrgId(orgId: OrgId): void {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('withTenantConnection: orgId is required');
  }
  // Cheap UUID sanity check — keeps a malformed value from being injected
  // via SET LOCAL even though we always parameterize.
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(orgId)) {
    throw new Error(`withTenantConnection: orgId is not a UUID: ${orgId}`);
  }
}

export async function withTenantConnection<T>(
  orgId: OrgId,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertOrgId(orgId);
  const client = await pool.connect();
  try {
    // SET LOCAL scopes to the current transaction. We're not in a tx yet so
    // use set_config(..., is_local=false) on this session. The client is
    // returned to the pool on release, but `RESET ALL` on release is the
    // pg pool's job — we belt-and-suspenders RESET below.
    await client.query("SELECT set_config('app.current_org', $1, false)", [orgId]);
    return await fn(client);
  } finally {
    try {
      await client.query("SELECT set_config('app.current_org', '', false)");
    } catch {
      // Best-effort cleanup; the pool will discard the client if it's
      // poisoned.
    }
    client.release();
  }
}

/**
 * Convenience for routes that just want one query. Equivalent to:
 *   await withTenantConnection(orgId, c => c.query(sql, params))
 */
export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
  orgId: OrgId,
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResult<T>> {
  return withTenantConnection(orgId, (client) =>
    client.query<T>(text, params as unknown[] | undefined),
  );
}

/**
 * Transactional variant — wraps the work in BEGIN/COMMIT and SET LOCAL.
 * Rolls back on any thrown error.
 */
export async function withTenantTransaction<T>(
  orgId: OrgId,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  assertOrgId(orgId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL is the right scope inside a transaction.
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transitional escape hatch: returns the USAV org id when a caller has
 * been migrated to require an orgId but doesn't yet have it threaded
 * through. New code MUST NOT call this.
 *
 * @deprecated Use `ctx.organizationId` from withAuth instead.
 */
export function transitionalUsavOrgId(): OrgId {
  return USAV_ORG_ID;
}
