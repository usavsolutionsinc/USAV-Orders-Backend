import type { Order } from '@/components/station/upnext/upnext-types';

/** Client-side filter for the shipping Up Next rail — tokenized substring match. */
export function filterShippingRailOrders(rows: Order[], query: string): Order[] {
  const trimmed = query.trim();
  if (!trimmed) return rows;
  const tokens = trimmed.toLowerCase().split(/\s+/);
  return rows.filter((order) => {
    const haystack = [
      order.product_title,
      order.sku,
      order.order_id,
      order.shipping_tracking_number,
      order.item_number,
      order.account_source,
      order.status,
      order.tester_name,
      String(order.id),
    ]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return tokens.every((token) => haystack.includes(token));
  });
}
