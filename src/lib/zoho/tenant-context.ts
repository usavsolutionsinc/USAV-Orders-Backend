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
 * ...)`. Anything not yet wrapped defaults to USAV, which is correct while USAV
 * is the only live tenant. Paying down that default = wrapping each entry point
 * (crons loop connected orgs; routes use ctx.organizationId).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { USAV_ORG_ID, type OrgId } from '@/lib/tenancy/constants';

const zohoOrgStore = new AsyncLocalStorage<OrgId>();

/** Bind the Zoho tenant org for every Zoho client call made inside `fn`. */
export function withZohoOrg<T>(orgId: OrgId, fn: () => Promise<T>): Promise<T> {
  return zohoOrgStore.run(orgId, fn);
}

/**
 * The tenant org for the current Zoho call. Read this only at the synchronous
 * client entry points (see the queue-boundary note above). Defaults to USAV
 * during the single-tenant transition.
 */
export function currentZohoOrgId(): OrgId {
  return zohoOrgStore.getStore() ?? USAV_ORG_ID;
}
