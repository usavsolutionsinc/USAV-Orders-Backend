import { createCrudHandler, ApiError } from '@/lib/api';
import pool from '@/lib/db';

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

async function searchOrders(query: string, limit: number): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT id, order_id, product_title, sku, account_source, shipment_id
     FROM orders
     WHERE order_id ILIKE $1
        OR product_title ILIKE $1
        OR sku ILIKE $1
        OR CAST(id AS TEXT) = $2
     ORDER BY created_at DESC NULLS LAST
     LIMIT $3`,
    [`%${query}%`, query, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'order' as const,
    title: String(row.product_title || `Order #${row.id}`),
    subtitle: [row.order_id, row.sku, row.account_source].filter(Boolean).join(' · '),
    href: `/dashboard?openOrderId=${row.id}`,
    matchField: 'order',
  }));
}

async function searchRepairs(query: string, limit: number): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT id, ticket_number, product_title, serial_number, status
     FROM repair_service
     WHERE ticket_number ILIKE $1
        OR product_title ILIKE $1
        OR serial_number ILIKE $1
        OR CAST(id AS TEXT) = $2
     ORDER BY created_at DESC NULLS LAST
     LIMIT $3`,
    [`%${query}%`, query, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'repair' as const,
    title: String(row.product_title || `Repair #${row.id}`),
    subtitle: [row.ticket_number, row.status].filter(Boolean).join(' · '),
    href: `/repair?tab=active&highlight=${row.id}`,
    matchField: 'repair',
  }));
}

async function searchFba(query: string, limit: number): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT id, shipment_ref, status
     FROM fba_shipments
     WHERE shipment_ref ILIKE $1
        OR CAST(id AS TEXT) = $2
     ORDER BY created_at DESC NULLS LAST
     LIMIT $3`,
    [`%${query}%`, query, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'fba' as const,
    title: String(row.shipment_ref || `FBA #${row.id}`),
    subtitle: String(row.status || 'Pending'),
    href: '/fba',
    matchField: 'fba',
  }));
}

async function searchReceiving(query: string, limit: number): Promise<SearchResult[]> {
  const result = await pool.query(
    `SELECT id, receiving_tracking_number, carrier
     FROM receiving
     WHERE receiving_tracking_number ILIKE $1
        OR CAST(id AS TEXT) = $2
     ORDER BY id DESC
     LIMIT $3`,
    [`%${query}%`, query, limit],
  );

  return result.rows.map((row: any) => ({
    id: Number(row.id),
    entityType: 'receiving' as const,
    title: String(row.receiving_tracking_number || `Receiving #${row.id}`),
    subtitle: String(row.carrier || 'Unknown carrier'),
    href: '/receiving',
    matchField: 'receiving',
  }));
}

const handler = createCrudHandler<SearchResult>({
  name: 'global-search',
  cacheNamespace: 'api:global-search',
  cacheTTL: 60,
  cacheTags: ['global-search', 'orders', 'repair-service', 'fba', 'receiving-logs'],

  list: async (params) => {
    if (!params.search) {
      return { rows: [] };
    }

    const perEntity = Math.ceil(params.limit / 4);
    const [orders, repairs, fba, receiving] = await Promise.all([
      searchOrders(params.search, perEntity).catch(() => []),
      searchRepairs(params.search, perEntity).catch(() => []),
      searchFba(params.search, perEntity).catch(() => []),
      searchReceiving(params.search, perEntity).catch(() => []),
    ]);

    const rows = [...orders, ...repairs, ...fba, ...receiving].slice(0, params.limit);
    return { rows, total: rows.length };
  },

  search: async (query, params) => {
    const perEntity = Math.ceil(params.limit / 4);
    const [orders, repairs, fba, receiving] = await Promise.all([
      searchOrders(query, perEntity).catch(() => []),
      searchRepairs(query, perEntity).catch(() => []),
      searchFba(query, perEntity).catch(() => []),
      searchReceiving(query, perEntity).catch(() => []),
    ]);

    return [...orders, ...repairs, ...fba, ...receiving].slice(0, params.limit);
  },
});

export const { GET } = handler;
