'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { isFbaOrder } from '@/utils/order-platform';

function toOrderRecord(order: any): ShippedOrder {
  return {
    ...order,
    deadline_at: order.deadline_at || null,
    shipment_id: order.shipment_id ?? null,
    packed_at: order.packed_at || null,
    packed_by: order.packed_by ?? null,
    tested_by: order.tested_by ?? null,
    serial_number: order.serial_number || '',
    condition: order.condition || '',
    // API returns tracking_number_raw aliased as tracking_number; map to the
    // canonical ShippedOrder field so details-panel and all consumers work.
    shipping_tracking_number: order.shipping_tracking_number || order.tracking_number || null,
  };
}

function isNonFbaRecord(record: ShippedOrder) {
  return !isFbaOrder(record.order_id, record.account_source);
}

export async function fetchPendingOrdersData({
  searchQuery = '',
  packedBy,
  testedBy,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
}) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) {
    params.set('q', searchQuery.trim());
  }
  // Pending view: only show orders with a shipment link that are not shipped and do not
  // have a matching packer_logs row by shipment_id.
  params.set('excludePacked', 'true');
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const url = params.toString() ? `/api/orders?${params.toString()}` : '/api/orders';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch pending orders');
  }

  const data = await res.json();
  const records = ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
  // When searching, return all matches regardless of shipment_id so an order
  // with no label is still discoverable from the pending view search bar.
  // Without a search query the view is scoped to label-assigned orders only
  // (those with a shipment_id); no-label orders belong in the unshipped view.
  return searchQuery.trim() ? records : records.filter((record) => record.shipment_id != null);
}

export async function fetchUnshippedOrdersData({
  searchQuery = '',
  packedBy,
  testedBy,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
}) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const res = await fetch(`/api/orders?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch unshipped orders');
  }

  const data = await res.json();
  const records = ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
  // When searching, lift the shipment_id == null restriction so orders with a
  // label can still be found from the unshipped tab's search bar.
  return searchQuery.trim() ? records : records.filter((record) => record.shipment_id == null);
}

export async function fetchDashboardShippedData({
  searchQuery = '',
  packedBy,
  testedBy,
  weekStart,
  weekEnd,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  weekStart?: string;
  weekEnd?: string;
}) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) {
    params.set('q', searchQuery.trim());
  } else {
    if (weekStart) params.set('weekStart', weekStart);
    if (weekEnd) params.set('weekEnd', weekEnd);
  }
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const url = `/api/shipped?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch shipped orders');
  }

  const data = await res.json();
  const shipped = Array.isArray(data.orders)
    ? data.orders
    : Array.isArray(data.shipped)
      ? data.shipped
      : Array.isArray(data.results)
        ? data.results
        : [];
  return ((shipped || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
}
