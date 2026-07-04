/**
 * page-context — maps the surface a search was issued FROM to the entity
 * types it most likely targets (AI search Phase 2, plan §8.1 / §12 "context
 * layers": per-page context injected on every AI search call).
 *
 * Pure + dependency-free. The retrieve route turns the CommandBar's
 * `pageContext` (a pathname) into a BOOST scope for hybridSearch — never a
 * hard filter: ⌘K is the global palette, and a receiving operator searching
 * an order id must still see order hits. Boosting only reorders equal-ish
 * candidates toward the surface the user is standing on.
 */

import type { SearchEntityType } from '@/lib/search/build-search-text';

/** First-path-segment → likely entity types. Order is meaningless. */
const SEGMENT_SCOPE: Record<string, SearchEntityType[]> = {
  dashboard: ['ORDER'],
  packer: ['ORDER'],
  shipped: ['ORDER'],
  receiving: ['RECEIVING'],
  incoming: ['RECEIVING'],
  products: ['SKU'],
  'sku-stock': ['SKU'],
  inventory: ['SERIAL_UNIT', 'SKU'],
  tech: ['SERIAL_UNIT'],
  testing: ['SERIAL_UNIT'],
  repair: ['REPAIR'],
  fba: ['FBA_SHIPMENT'],
};

/**
 * Resolve a pageContext string (pathname, possibly with query) to a boost
 * scope. Unknown/blank/global surfaces (operations, studio, ai-chat, …)
 * return undefined — no boost.
 */
export function pageContextToEntityTypes(
  pageContext: string | null | undefined,
): SearchEntityType[] | undefined {
  if (!pageContext) return undefined;
  let path = pageContext.trim();
  if (!path) return undefined;
  // Tolerate full URLs and query strings — we only care about the pathname.
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return undefined;
  }
  const [segment] = path.replace(/^\/+/, '').split(/[/?#]/, 1);
  if (!segment) return undefined;
  const scope = SEGMENT_SCOPE[segment.toLowerCase()];
  return scope ? [...scope] : undefined;
}
