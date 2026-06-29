import { createCrudHandler, ApiError } from '@/lib/api';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * Global search across orders, repairs, FBA shipments, and receiving.
 * Used by the CommandBar (Cmd+K) for cross-entity lookup.
 *
 * GET /api/global-search?q=<query>&limit=20
 *
 * Built with createCrudHandler — demonstrates the unified CRUD pattern
 * for a read-only search endpoint.
 */

interface SearchResult {
  id: number;
  entityType: 'order' | 'repair' | 'fba' | 'receiving' | 'sku';
  title: string;
  subtitle: string;
  href: string;
  matchField: string;
}

async function searchOrders(orgId: OrgId, query: string, limit: number): Promise<SearchResult[]> {
  // Mirror the unshipped/shipped order search: match order_id, title, SKU, the
  // order's serial number(s) (tech_serial_numbers, joined via shipment_id) and
  // the carrier tracking number, plus a last-8-digit fallback so a partial
  // order/tracking number still resolves. Serials are aggregated per order so a
  // single row comes back even when an order has many tested units.
  // Tenant scope: the org lock is `o.organization_id`; the tech_serial_numbers /
  // shipping_tracking_numbers joins reach only rows tied to that org-scoped order
  // (the GUC set by tenantQuery is the backstop) — same pattern as searchReceiving.
  const digits = query.replace(/\D/g, '');
  const last8 = digits.length >= 8 ? digits.slice(-8) : '';
  const result = await tenantQuery(
    orgId,
    `SELECT o.id,
            o.order_id,
            o.product_title,
            o.sku,
            o.account_source,
            COALESCE(STRING_AGG(DISTINCT tsn.serial_number, ', '), '') AS serial_number,
            MAX(stn.tracking_number_raw)                              AS tracking_number
     FROM orders o
     LEFT JOIN tech_serial_numbers tsn       ON tsn.shipment_id = o.shipment_id
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
     WHERE o.organization_id = $1
       AND (
            o.order_id ILIKE $2
         OR o.product_title ILIKE $2
         OR o.sku ILIKE $2
         OR tsn.serial_number ILIKE $2
         OR stn.tracking_number_raw ILIKE $2
         OR CAST(o.id AS TEXT) = $3
         OR ($4 <> '' AND RIGHT(regexp_replace(COALESCE(o.order_id, ''), '[^0-9]', '', 'g'), 8) = $4)
         OR ($4 <> '' AND RIGHT(regexp_replace(UPPER(COALESCE(stn.tracking_number_normalized, '')), '[^A-Z0-9]', '', 'g'), 8) = $4)
       )
     GROUP BY o.id
     ORDER BY o.created_at DESC NULLS LAST
     LIMIT $5`,
    [orgId, `%${query}%`, query, last8, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'order' as const,
    title: String(row.product_title || `Order #${row.id}`),
    subtitle: [row.order_id, row.serial_number, row.sku, row.account_source]
      .filter(Boolean)
      .join(' · '),
    href: `/dashboard?openOrderId=${row.id}`,
    matchField: 'order',
  }));
}

async function searchRepairs(orgId: OrgId, query: string, limit: number): Promise<SearchResult[]> {
  const result = await tenantQuery(
    orgId,
    `SELECT id, ticket_number, product_title, serial_number, status
     FROM repair_service
     WHERE organization_id = $4
       AND (ticket_number ILIKE $1
        OR product_title ILIKE $1
        OR serial_number ILIKE $1
        OR CAST(id AS TEXT) = $2)
     ORDER BY created_at DESC NULLS LAST
     LIMIT $3`,
    [`%${query}%`, query, limit, orgId],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'repair' as const,
    title: String(row.product_title || `Repair #${row.id}`),
    subtitle: [row.ticket_number, row.status].filter(Boolean).join(' · '),
    href: `/repair?tab=active&openRepair=${row.id}`,
    matchField: 'repair',
  }));
}

async function searchFba(orgId: OrgId, query: string, limit: number): Promise<SearchResult[]> {
  const result = await tenantQuery(
    orgId,
    `SELECT id, shipment_ref, status
     FROM fba_shipments
     WHERE organization_id = $3
       AND (shipment_ref ILIKE $1
        OR CAST(id AS TEXT) = $2)
     ORDER BY created_at DESC NULLS LAST
     LIMIT $4`,
    [`%${query}%`, query, orgId, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'fba' as const,
    title: String(row.shipment_ref || `FBA #${row.id}`),
    subtitle: String(row.status || 'Pending'),
    href: `/fba?openShipmentId=${row.id}`,
    matchField: 'fba',
  }));
}

async function searchReceiving(orgId: OrgId, query: string, limit: number): Promise<SearchResult[]> {
  // Join shipping_tracking_numbers so search matches rows reachable only via
  // receiving.shipment_id (post inbound-tracking unification). Falls back to
  // hyphens/spaces carriers sometimes include.
  // Tenant scope: receiving carries organization_id, so filter on it. The
  // shipping_tracking_numbers join (`stn`) has NO organization_id column yet
  // (NEEDS-COL) — it is reachable only through this org-scoped receiving row,
  // so the GUC-wrapped tenantQuery is the isolation backstop for it.
  const normalizedQuery = query.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const result = await tenantQuery(
    orgId,
    `SELECT r.id,
            stn.tracking_number_raw AS tracking_number,
            COALESCE(NULLIF(stn.carrier, 'UNKNOWN'), r.carrier)             AS carrier
     FROM receiving r
     LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
     WHERE r.organization_id = $5
       AND (stn.tracking_number_raw ILIKE $1
        OR stn.tracking_number_raw     ILIKE $1
        OR stn.tracking_number_normalized = $3
        OR CAST(r.id AS TEXT) = $2)
     ORDER BY r.id DESC
     LIMIT $4`,
    [`%${query}%`, query, normalizedQuery, limit, orgId],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'receiving' as const,
    title: String(row.tracking_number || `Receiving #${row.id}`),
    subtitle: String(row.carrier || 'Unknown carrier'),
    href: `/receiving?mode=receive&openReceivingId=${row.id}`,
    matchField: 'receiving',
  }));
}

async function searchSkus(orgId: OrgId, query: string, limit: number): Promise<SearchResult[]> {
  // sku_catalog is the marketplace SKU scheme the Products workbench selects on
  // (NOT the Zoho `items` namespace — they collide on the same strings). Match
  // the SKU string or title; deep-link to the workbench with the numeric
  // sku_catalog.id, which the sidebar picker reads from ?skuId=.
  const result = await tenantQuery(
    orgId,
    `SELECT id, sku, product_title
     FROM sku_catalog
     WHERE organization_id = $3
       AND is_active = true
       AND (sku ILIKE $1 OR product_title ILIKE $1)
     ORDER BY CASE WHEN UPPER(sku) = UPPER($2) THEN 0 ELSE 1 END,
              product_title ASC NULLS LAST
     LIMIT $4`,
    [`%${query}%`, query, orgId, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'sku' as const,
    title: String(row.product_title || row.sku),
    subtitle: String(row.sku),
    href: `/products?view=qc&skuId=${row.id}`,
    matchField: 'sku',
  }));
}

/**
 * Build the CRUD handler bound to a single tenant. Constructed per-request so
 * the org id from the verified session is threaded into every search helper,
 * and so the Upstash cache namespace is partitioned by org (a shared namespace
 * would serve one tenant's results to another).
 */
function buildHandler(orgId: OrgId) {
  return createCrudHandler<SearchResult>({
    name: 'global-search',
    cacheNamespace: `api:global-search:${orgId}`,
    cacheTTL: 60,
    cacheTags: ['global-search', 'orders', 'repair-service', 'fba', 'receiving-logs', 'sku-catalog'],

    list: async (params) => {
      if (!params.search) {
        return { rows: [] };
      }

      const perEntity = Math.ceil(params.limit / 5);
      const [orders, repairs, fba, receiving, skus] = await Promise.all([
        searchOrders(orgId, params.search, perEntity).catch(() => []),
        searchRepairs(orgId, params.search, perEntity).catch(() => []),
        searchFba(orgId, params.search, perEntity).catch(() => []),
        searchReceiving(orgId, params.search, perEntity).catch(() => []),
        searchSkus(orgId, params.search, perEntity).catch(() => []),
      ]);

      const rows = [...orders, ...repairs, ...fba, ...receiving, ...skus].slice(0, params.limit);
      return { rows, total: rows.length };
    },

    search: async (query, params) => {
      const perEntity = Math.ceil(params.limit / 5);
      const [orders, repairs, fba, receiving, skus] = await Promise.all([
        searchOrders(orgId, query, perEntity).catch(() => []),
        searchRepairs(orgId, query, perEntity).catch(() => []),
        searchFba(orgId, query, perEntity).catch(() => []),
        searchReceiving(orgId, query, perEntity).catch(() => []),
        searchSkus(orgId, query, perEntity).catch(() => []),
      ]);

      return [...orders, ...repairs, ...fba, ...receiving, ...skus].slice(0, params.limit);
    },
  });
}

// Cross-domain search used by the Cmd+K bar — require an authenticated session
// (any staff role). Was previously exported bare (unauthenticated + invisible
// to the route-permission audit). The handler is built per-request bound to the
// caller's org so every entity query is tenant-scoped.
export const GET = withAuth((req, ctx) => buildHandler(ctx.organizationId).GET(req));
