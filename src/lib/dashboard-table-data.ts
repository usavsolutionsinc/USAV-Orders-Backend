'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { PackerRecord } from '@/hooks/usePackerLogs';
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
  strictSearchScope = false,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  strictSearchScope?: boolean;
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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch pending orders');
  }

  const data = await res.json();
  const records = ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
  // When searching, return all matches regardless of shipment_id so an order
  // with no label is still discoverable from the pending view search bar.
  // Without a search query the view is scoped to label-assigned orders only
  // (those with a shipment_id); no-label orders belong in the unshipped view.
  if (searchQuery.trim() && !strictSearchScope) return records;
  return records.filter((record) => record.shipment_id != null);
}

/** One pending-queue row by DB order id (bypasses list cache on the server). */
export async function fetchPendingOrderRowById(
  orderId: number,
  options: { searchQuery?: string; packedBy?: number; testedBy?: number } = {}
): Promise<ShippedOrder | null> {
  if (!Number.isFinite(orderId) || orderId <= 0) return null;
  const params = new URLSearchParams();
  params.set('orderId', String(orderId));
  params.set('excludePacked', 'true');
  const q = String(options.searchQuery || '').trim();
  if (q) params.set('q', q);
  if (options.packedBy !== undefined) params.set('packedBy', String(options.packedBy));
  if (options.testedBy !== undefined) params.set('testedBy', String(options.testedBy));

  const res = await fetch(`/api/orders?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  const records = ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
  const visible = q ? records : records.filter((record) => record.shipment_id != null);
  return visible[0] ?? null;
}

export async function fetchDashboardOrderRowById(orderId: number): Promise<ShippedOrder | null> {
  if (!Number.isFinite(orderId) || orderId <= 0) return null;

  const params = new URLSearchParams();
  params.set('orderId', String(orderId));
  params.set('includeShipped', 'true');

  const res = await fetch(`/api/orders?${params.toString()}`);
  if (!res.ok) return null;

  const data = await res.json();
  const records = ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
  const orderRecord = records[0] ?? null;
  if (!orderRecord) return null;

  const shippedSearchKey = String(orderRecord.order_id || orderId).trim();
  if (!shippedSearchKey) return orderRecord;

  try {
    const shippedResults = await fetchDashboardShippedData({ searchQuery: shippedSearchKey });
    const exact = shippedResults.find((record) => Number(record.id) === orderId);
    return exact ?? orderRecord;
  } catch {
    return orderRecord;
  }
}

export async function fetchUnshippedOrdersData({
  searchQuery = '',
  packedBy,
  testedBy,
  strictSearchScope = false,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  strictSearchScope?: boolean;
}) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));
  // Awaiting tab: only orders without tracking (shipment_id). When searching,
  // omit so search can find any order; client still filters for display.
  if (!searchQuery.trim()) params.set('awaitingOnly', 'true');

  const res = await fetch(`/api/orders?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to fetch unshipped orders');
  }

  const data = await res.json();
  const records = ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
  // When searching, show all matches (including those with tracking) so user can find any order.
  // When not searching, API already filtered via awaitingOnly=true.
  if (searchQuery.trim() && !strictSearchScope) return records;
  return records.filter((record) => record.shipment_id == null);
}

export async function fetchDashboardShippedData({
  searchQuery = '',
  packedBy,
  testedBy,
  weekStart,
  weekEnd,
  shippedFilter,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  weekStart?: string;
  weekEnd?: string;
  /** When provided the server filters by type; omit for backward-compat (client filters FBA). */
  shippedFilter?: string;
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
  if (shippedFilter) params.set('shippedFilter', shippedFilter);

  const url = `/api/shipped?${params.toString()}`;
  const res = await fetch(url);
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
  const records = (shipped || []).map(toOrderRecord) as ShippedOrder[];
  // When shippedFilter is provided the server already scopes the results;
  // fall back to client-side FBA exclusion only for backward-compat callers.
  return shippedFilter ? records : records.filter(isNonFbaRecord);
}

export async function fetchDashboardPackedRecords({
  packedBy,
  testedBy,
  weekStart,
  weekEnd,
  shippedFilter,
}: {
  packedBy?: number;
  testedBy?: number;
  weekStart?: string;
  weekEnd?: string;
  shippedFilter?: string;
}) {
  const params = new URLSearchParams({ limit: '1000' });
  if (weekStart) params.set('weekStart', weekStart);
  if (weekEnd) params.set('weekEnd', weekEnd);
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));
  if (shippedFilter) params.set('shippedFilter', shippedFilter);

  const res = await fetch(`/api/packerlogs?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to fetch packed records');
  }

  const data = await res.json();
  return (Array.isArray(data) ? data : []) as PackerRecord[];
}
