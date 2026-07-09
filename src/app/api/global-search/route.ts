import { createCrudHandler } from '@/lib/api';
import type { OrgId } from '@/lib/tenancy/constants';
import { withAuth } from '@/lib/auth/withAuth';
import { searchAllEntities, type GlobalSearchResult } from '@/lib/search/global-entity-search';

/**
 * Global search across orders, repairs, FBA shipments, and receiving.
 * Used by the CommandBar (Cmd+K) for cross-entity lookup.
 *
 * GET /api/global-search?q=<query>&limit=20
 *
 * Built with createCrudHandler — demonstrates the unified CRUD pattern
 * for a read-only search endpoint.
 *
 * The per-entity searchers were extracted verbatim to
 * src/lib/search/global-entity-search.ts (AI search Phase 0) so the hybrid
 * engine's exact-ID/serial bypass reuses them; this route's behavior is
 * unchanged.
 */

/**
 * Build the CRUD handler bound to a single tenant. Constructed per-request so
 * the org id from the verified session is threaded into every search helper,
 * and so the Upstash cache namespace is partitioned by org (a shared namespace
 * would serve one tenant's results to another).
 */
function buildHandler(orgId: OrgId) {
  return createCrudHandler<GlobalSearchResult>({
    name: 'global-search',
    cacheNamespace: `api:global-search:${orgId}`,
    cacheTTL: 60,
    cacheTags: ['global-search', 'orders', 'repair-service', 'fba', 'receiving-logs', 'sku-catalog'],

    list: async (params) => {
      if (!params.search) {
        return { rows: [] };
      }
      const rows = await searchAllEntities(orgId, params.search, params.limit);
      return { rows, total: rows.length };
    },

    search: async (query, params) => {
      return searchAllEntities(orgId, query, params.limit);
    },
  });
}

// Cross-domain search used by the Cmd+K bar — require an authenticated session
// (any staff role). Was previously exported bare (unauthenticated + invisible
// to the route-permission audit). The handler is built per-request bound to the
// caller's org so every entity query is tenant-scoped.
export const GET = withAuth((req, ctx) => buildHandler(ctx.organizationId).GET(req));
