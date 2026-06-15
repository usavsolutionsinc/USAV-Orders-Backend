/**
 * Tenant-scoped DB helper.
 *
 * Every request that touches business data should run inside
 * `withTenantConnection(orgId, fn)`. The wrapper checks out a client from
 * the shared pool, sets `app.current_org` as a session GUC, runs the work,
 * and releases the client.
 *
 * The GUC is the hook that RLS policies bind against — every enforced
 * table's `organization_id = current_setting('app.current_org')::uuid`
 * policy is a backstop against handlers that forget to filter explicitly.
 * Most business tables already carry `organization_id`; FORCE enforcement is
 * being rolled out per table (Phase E) once every route touching a table is
 * GUC-wrapped. Note enforcement only bites under the non-BYPASSRLS
 * `app_tenant` role — `neondb_owner` bypasses RLS (see the tenancy exec plan).
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
import { tenantPool } from '@/lib/db';
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
  // Use the tenant pool: once TENANT_APP_DATABASE_URL points at the non-bypass
  // app_tenant role (Phase E1), these GUC-scoped paths become RLS-subject and
  // per-table FORCE can be enabled. Until then tenantPool aliases the owner pool.
  const client = await tenantPool.connect();
  try {
    // Run the work inside a transaction and set the org GUC with SET LOCAL
    // (is_local=true). SET LOCAL is scoped to THIS transaction and auto-clears
    // on COMMIT/ROLLBACK, so a stale `app.current_org` can never survive on a
    // pooled client into the next checkout. That matters once RLS is enforced:
    // the loud-fail column default reads `current_setting('app.current_org')`,
    // so a leftover session GUC could silently mis-attribute a later raw-pool
    // INSERT to the wrong tenant. A transaction-scoped GUC closes that hole.
    // (Read-only `fn`s are fine inside a transaction; we COMMIT either way.)
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* swallow — client is discarded on release */ }
    throw err;
  } finally {
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
 * Transactional variant — explicit name for write paths. Now identical to
 * `withTenantConnection` (which is itself transactional with SET LOCAL), so it
 * delegates; the separate name documents write intent at call sites.
 */
export async function withTenantTransaction<T>(
  orgId: OrgId,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenantConnection(orgId, fn);
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
