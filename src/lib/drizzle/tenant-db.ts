/**
 * Tenant-scoped Drizzle — the GUC-carrying counterpart to `src/lib/drizzle/db.ts`.
 *
 * The default `db` (drizzle/db.ts) uses the neon-HTTP transport, which is
 * stateless (one HTTP request per statement) and therefore CANNOT carry the
 * `app.current_org` session GUC that RLS policies bind against. Repositories
 * that must be tenant-isolated — and whose tables will be FORCE-enforced
 * (Phase E) — run their Drizzle queries here instead.
 *
 * This reuses `withTenantConnection` (a WebSocket-pool client inside a
 * transaction with `SET LOCAL app.current_org`), then hands `fn` a Drizzle
 * instance bound to that session-carrying client, so the GUC is live for every
 * statement in the callback.
 *
 * Usage:
 *   import { eq } from 'drizzle-orm';
 *   await withTenantDrizzle(orgId, (tx) =>
 *     tx.select().from(salesOrders).where(eq(salesOrders.organizationId, orgId)));
 *
 * Always keep the explicit `organization_id` predicate — RLS is defense in
 * depth, NOT a substitute for a correct WHERE/INSERT.
 *
 * See docs/tenancy/multi-tenancy-execution-plan.md §Phase C5.
 */
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import type { PoolClient } from 'pg';
import * as schema from './schema';
import { withTenantConnection } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type TenantDrizzle = NeonDatabase<typeof schema>;

export async function withTenantDrizzle<T>(
  orgId: OrgId,
  fn: (tx: TenantDrizzle) => Promise<T>,
): Promise<T> {
  return withTenantConnection(orgId, (client: PoolClient) =>
    // The WS pool client is a @neondatabase/serverless client cast to pg's
    // PoolClient at the pool boundary; neon-serverless drizzle accepts it.
    fn(drizzle(client as never, { schema }) as TenantDrizzle),
  );
}
