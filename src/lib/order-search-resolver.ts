/**
 * Resolves which view (shipped vs pending) an order search belongs to.
 * Used by dashboard and tech page to route search results to the correct tab.
 */

export type OrderSearchView = 'shipped' | 'pending' | null;

export interface OrderSearchResult {
  view: OrderSearchView;
  orders: Array<{ id: number }>;
  firstOrderId?: number;
}

/**
 * Fetches orders for a query in both shipped (packed) and pending (exclude packed) views.
 * Returns the first non-empty result and its view. Shipped is checked first.
 */
export async function resolveOrderSearchView(query: string): Promise<OrderSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { view: null, orders: [] };
  }

  try {
    const shippedParams = new URLSearchParams({ q: trimmed });
    const shippedRes = await fetch(`/api/shipped?${shippedParams.toString()}`, { cache: 'no-store' });
    if (shippedRes.ok) {
      const shippedJson = await shippedRes.json();
      const shippedOrders = Array.isArray(shippedJson?.results)
        ? shippedJson.results
        : Array.isArray(shippedJson?.shipped)
          ? shippedJson.shipped
          : [];
      if (shippedOrders.length > 0) {
        return {
          view: 'shipped',
          orders: shippedOrders.map((o: { id: number }) => ({ id: o.id })),
          firstOrderId: shippedOrders[0]?.id,
        };
      }
    }
  } catch {
    // Fall through to pending check
  }

  try {
    // Check pending (exclude packed)
    const pendingParams = new URLSearchParams({
      q: trimmed,
      excludePacked: 'true',
    });
    const pendingRes = await fetch(`/api/orders?${pendingParams.toString()}`, { cache: 'no-store' });
    if (pendingRes.ok) {
      const pendingJson = await pendingRes.json();
      const pendingOrders = Array.isArray(pendingJson?.orders) ? pendingJson.orders : [];
      if (pendingOrders.length > 0) {
        return {
          view: 'pending',
          orders: pendingOrders.map((o: { id: number }) => ({ id: o.id })),
          firstOrderId: pendingOrders[0]?.id,
        };
      }
    }
  } catch {
    // Fall through
  }

  return { view: null, orders: [] };
}
