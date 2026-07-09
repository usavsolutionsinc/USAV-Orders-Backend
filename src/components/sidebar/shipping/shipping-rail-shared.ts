import type { Order } from '@/components/station/upnext/upnext-types';

/** React-query key for the shipping sidebar rail. */
export function shippingRailQueryKey(feed: 'queue' | 'stock', techId: string) {
  return ['shipping-recent-rail', feed, techId] as const;
}

export const SHIPPING_RAIL_REFRESH_EVENTS = [
  'usav-refresh-data',
  'dashboard-refresh',
] as const;

/** Normalize `/api/orders/next` rows into the shared `Order` shape. */
export function normalizeUpNextOrders(rows: unknown[]): Order[] {
  const pending = Array.isArray(rows) ? rows : [];
  const normalized: Order[] = pending.map((row: any) => ({
    id: Number(row.id),
    ship_by_date: row.ship_by_date ?? row.deadline_at ?? null,
    created_at: row.created_at ?? null,
    order_id: String(row.order_id || ''),
    product_title: String(row.product_title || ''),
    item_number: row.item_number ?? null,
    account_source: row.account_source ?? null,
    sku: String(row.sku || ''),
    condition: row.condition ?? null,
    quantity: row.quantity ?? null,
    status: String(row.status || ''),
    shipping_tracking_number: String(row.shipping_tracking_number || row.tracking_number || ''),
    out_of_stock: row.out_of_stock ?? null,
    tester_id: row.tester_id ?? null,
    tester_name: row.tester_name ?? null,
    has_tech_scan: Boolean(row.has_tech_scan),
    is_shipped: Boolean(row.is_shipped),
  }));

  const deduped = normalized.filter(
    (row, idx, arr) => arr.findIndex((cand) => Number(cand.id) === Number(row.id)) === idx,
  );

  return deduped.filter((order) => !order.has_tech_scan);
}

/** Earliest ship-by first — the tech queue's default "must go" ordering. */
export function sortOrdersByShipBy(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    const da = a.ship_by_date ? new Date(a.ship_by_date).getTime() : Number.POSITIVE_INFINITY;
    const db = b.ship_by_date ? new Date(b.ship_by_date).getTime() : Number.POSITIVE_INFINITY;
    return da - db;
  });
}
