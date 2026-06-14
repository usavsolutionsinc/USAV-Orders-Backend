/**
 * Cached, server-side read layer for the org platform / type catalog
 * (migration 2026-06-13g). Mirrors the in-process cache pattern of
 * `getIntegrationCredentials` (src/lib/integrations/credentials.ts): each org's
 * lists are cached for 5 minutes and invalidated explicitly on any CRUD write
 * via {@link invalidateCatalogCache}.
 *
 * Use this — not the raw `catalog-queries` functions — from server code that
 * resolves a platform/type per request (e.g. write-validation, API response
 * formatting), so the DB isn't hit on every call. Client code uses the
 * `useCatalog` React Query hooks instead.
 *
 * `platform_accounts` getters + `resolveType` (type→account→platform→provider
 * join) are deferred until the accounts table + `type_id` FK land (plan
 * phases 2/4); add them here when a consumer needs them.
 */

import { listPlatforms, listTypes, type PlatformRow, type TypeRow } from '@/lib/neon/catalog-queries';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;

const platformCache = new Map<string, CacheEntry<PlatformRow[]>>();
const typeCache = new Map<string, CacheEntry<TypeRow[]>>();

/** Active platforms for the org (sorted), cached 5 min. */
export async function getOrgPlatforms(orgId: string): Promise<PlatformRow[]> {
  const hit = platformCache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const rows = await listPlatforms(orgId);
  platformCache.set(orgId, { value: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

/** Active receiving/flow types for the org (sorted), cached 5 min. */
export async function getOrgTypes(orgId: string): Promise<TypeRow[]> {
  const hit = typeCache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const rows = await listTypes(orgId);
  typeCache.set(orgId, { value: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

/** Drop cached lists for one org (or all when omitted). Call on any CRUD write. */
export function invalidateCatalogCache(orgId?: string): void {
  if (!orgId) {
    platformCache.clear();
    typeCache.clear();
    return;
  }
  platformCache.delete(orgId);
  typeCache.delete(orgId);
}
