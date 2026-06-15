/**
 * Cached, server-side read layer for the org platform / type catalog
 * (migration 2026-06-13g + 2026-06-14f). Mirrors the in-process cache pattern
 * of `getIntegrationCredentials` (src/lib/integrations/credentials.ts): each
 * org's lists are cached for 5 minutes and invalidated explicitly on any CRUD
 * write via {@link invalidateCatalogCache}.
 *
 * Use this — not the raw `catalog-queries` functions — from server code that
 * resolves a platform/type/account per request (write-validation, dual-write,
 * API response formatting), so the DB isn't hit on every call. Client code uses
 * the `useCatalog` React Query hooks instead.
 */

import {
  listPlatforms,
  listPlatformAccounts,
  listTypes,
  type PlatformAccountRow,
  type PlatformRow,
  type TypeRow,
} from '@/lib/neon/catalog-queries';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;

const platformCache = new Map<string, CacheEntry<PlatformRow[]>>();
const typeCache = new Map<string, CacheEntry<TypeRow[]>>();
const accountCache = new Map<string, CacheEntry<PlatformAccountRow[]>>();

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

/** Active storefront accounts for the org, cached 5 min. */
export async function getOrgPlatformAccounts(orgId: string): Promise<PlatformAccountRow[]> {
  const hit = accountCache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const rows = await listPlatformAccounts(orgId);
  accountCache.set(orgId, { value: rows, expiresAt: Date.now() + CACHE_TTL_MS });
  return rows;
}

/** A flow type joined to its bound account → platform → integration. */
export interface ResolvedType {
  type: TypeRow;
  account: PlatformAccountRow | null;
  platform: PlatformRow | null;
  /** organization_integrations.provider reachable via the platform (null = display-only). */
  provider: string | null;
  /** organization_integrations.scope reachable via the bound account. */
  integrationScope: string | null;
  /** workflow_nodes.id this type drives (null = no custom flow). */
  workflowNodeId: string | null;
}

/**
 * Resolve a `type_id` to its full chain: flow → account → platform → integration
 * → workflow. From a single id on a receiving/order row this reaches everything
 * the plan's linkage diagram promises. Returns null if the id isn't this org's.
 */
export async function resolveType(orgId: string, typeId: number): Promise<ResolvedType | null> {
  const [types, accounts, platforms] = await Promise.all([
    getOrgTypes(orgId),
    getOrgPlatformAccounts(orgId),
    getOrgPlatforms(orgId),
  ]);
  const type = types.find((t) => t.id === typeId);
  if (!type) return null;
  const account = type.platform_account_id
    ? accounts.find((a) => a.id === type.platform_account_id) ?? null
    : null;
  const platform = account ? platforms.find((p) => p.id === account.platform_id) ?? null : null;
  return {
    type,
    account,
    platform,
    provider: platform?.provider ?? null,
    integrationScope: account?.integration_scope ?? null,
    workflowNodeId: type.workflow_node_id,
  };
}

/**
 * Resolve the carton's effective receiving flow to a `type_id` for dual-write.
 * Maps the denormalized text (`intake_type`, falling back to `is_return`) to the
 * matching active type slug. Returns null when nothing maps (the backfill's
 * dry-run reports these so they're never silently dropped).
 */
export async function resolveReceivingTypeId(
  orgId: string,
  input: { intakeType?: string | null; isReturn?: boolean | null },
): Promise<number | null> {
  const slug = receivingTypeSlug(input);
  if (!slug) return null;
  const types = await getOrgTypes(orgId);
  return types.find((t) => t.slug.toLowerCase() === slug)?.id ?? null;
}

/** Pure intake_type/is_return → type slug mapping (shared with the backfill). */
export function receivingTypeSlug(input: { intakeType?: string | null; isReturn?: boolean | null }): string | null {
  const it = String(input.intakeType ?? '').trim().toLowerCase();
  if (it) return it; // 'po' | 'return' | 'trade_in' | 'pickup' | custom slug
  if (input.isReturn) return 'return';
  return 'po'; // default carton flow when no explicit type is set
}

/** A resolved order channel: which platform an `account_source` value belongs to. */
export interface ResolvedChannel {
  platform: PlatformRow | null;
  account: PlatformAccountRow | null;
  /** Canonical label to show (platform label wins; account label as a fallback). */
  label: string | null;
}

/**
 * Resolve `orders.account_source` (hybrid grain: eBay = account slug like
 * 'ebay-mk', others = platform slug like 'ecwid'/'fba') to its catalog platform.
 * This is the read-side that the order-channel display overlays on top of the
 * built-in `getOrderPlatformLabel` so renamed/custom channels read correctly.
 * Returns all-null when the value matches nothing in the catalog (caller falls
 * back to the built-in helper).
 */
export async function resolveOrderChannel(orgId: string, accountSource: string | null | undefined): Promise<ResolvedChannel> {
  const key = String(accountSource ?? '').trim().toLowerCase();
  if (!key) return { platform: null, account: null, label: null };
  const [accounts, platforms] = await Promise.all([getOrgPlatformAccounts(orgId), getOrgPlatforms(orgId)]);
  // account-grain first (eBay account names), then platform-grain.
  const account = accounts.find((a) => a.slug.toLowerCase() === key) ?? null;
  const platform = account
    ? platforms.find((p) => p.id === account.platform_id) ?? null
    : platforms.find((p) => p.slug.toLowerCase() === key) ?? null;
  return { platform, account, label: platform?.label ?? account?.label ?? null };
}

/** Drop cached lists for one org (or all when omitted). Call on any CRUD write. */
export function invalidateCatalogCache(orgId?: string): void {
  if (!orgId) {
    platformCache.clear();
    typeCache.clear();
    accountCache.clear();
    return;
  }
  platformCache.delete(orgId);
  typeCache.delete(orgId);
  accountCache.delete(orgId);
}
