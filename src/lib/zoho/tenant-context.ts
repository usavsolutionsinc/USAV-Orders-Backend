/**
 * Zoho tenant context.
 *
 * The Zoho client is shared, but every request must resolve credentials and an
 * `organization_id` for ONE tenant. There is no global request-scoped tenant
 * AsyncLocalStorage in this codebase (the DB layer threads `orgId` explicitly
 * via withTenantConnection), so this is a Zoho-local ambient binding whose only
 * job is to carry the tenant id from a tenant-aware entry point down to the
 * client's public functions WITHOUT rewriting all ~150 call sites at once.
 *
 * IMPORTANT — queue boundary. The value set here is captured SYNCHRONOUSLY at
 * the public client entry points (zohoGet/zohoPost/zohoPut/zohoDelete/
 * paginateZohoList) via `currentZohoOrgId()`, BEFORE the request is handed to
 * the rate limiter. The limiter executes the queued task in a different async
 * context, so the AsyncLocalStorage store does NOT survive into
 * performZohoRequest — everything past the entry point receives `orgId` as an
 * explicit argument. Do not read `currentZohoOrgId()` below the queue.
 *
 * Adoption: a tenant-aware caller wraps its Zoho work in `withZohoOrg(orgId,
 * ...)`. Every entry point must bind explicitly (crons loop connected orgs via
 * forEachOrgWithProvider; routes use ctx.organizationId). An unbound read
 * THROWS — the old silent USAV fallback was a cross-tenant credential leak
 * (audit F10). Residual unfixable callers carry a targeted shim greppable as
 * ZOHO_ORG_TRANSITIONAL; never reintroduce a module-level default here.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgId } from '@/lib/tenancy/constants';

const zohoOrgStore = new AsyncLocalStorage<OrgId>();

/** Bind the Zoho tenant org for every Zoho client call made inside `fn`. */
export function withZohoOrg<T>(orgId: OrgId, fn: () => Promise<T>): Promise<T> {
  return zohoOrgStore.run(orgId, fn);
}

/**
 * The tenant org for the current Zoho call. Read this only at the synchronous
 * client entry points (see the queue-boundary note above). Fails closed: an
 * unbound read throws instead of silently resolving USAV's credentials.
 */
export function currentZohoOrgId(): OrgId {
  const orgId = zohoOrgStore.getStore();
  if (!orgId) {
    throw new Error('zoho org context unbound — wrap the call in withZohoOrg(orgId, …)');
  }
  return orgId;
}

/**
 * Whether a tenant org is bound for the current async context. Only for the
 * ZOHO_ORG_TRANSITIONAL shims that bridge callers which cannot bind yet —
 * regular code should bind with `withZohoOrg` and never need to ask.
 */
export function hasZohoOrgBinding(): boolean {
  return zohoOrgStore.getStore() != null;
}
