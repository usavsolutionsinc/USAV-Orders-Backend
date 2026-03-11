'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { isFbaOrder } from '@/utils/order-platform';

function toOrderRecord(order: any): ShippedOrder {
  return {
    ...order,
    pack_date_time: order.ship_by_date || null,
    packed_by: order.packer_id ?? null,
    tested_by: order.tested_by ?? null,
    serial_number: '',
    condition: order.condition || '',
  };
}

function isNonFbaRecord(record: ShippedOrder) {
  return !isFbaOrder(record.order_id, record.account_source);
}

export async function fetchPendingOrdersData({
  searchQuery = '',
  packedBy,
  testedBy,
  pendingOnly = false,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  pendingOnly?: boolean;
}) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (searchQuery.trim()) params.set('includeShipped', 'true');
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));
  if (pendingOnly) params.set('pendingOnly', 'true');

  const url = params.toString() ? `/api/orders?${params.toString()}` : '/api/orders';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch pending orders');
  }

  const data = await res.json();
  return ((data.orders || []).map(toOrderRecord) as ShippedOrder[])
    .filter((record) => String(record.shipping_tracking_number || '').trim().length > 0)
    .filter(isNonFbaRecord);
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
  params.set('missingTrackingOnly', 'true');
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const res = await fetch(`/api/orders?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch unshipped orders');
  }

  const data = await res.json();
  return ((data.orders || []).map(toOrderRecord) as ShippedOrder[])
    .filter((record) => String(record.shipping_tracking_number || '').trim().length === 0)
    .filter(isNonFbaRecord);
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
  params.set('shippedOnly', 'true');
  params.set('includeShipped', 'true');
  if (searchQuery.trim()) {
    params.set('q', searchQuery.trim());
  } else {
    if (weekStart) params.set('weekStart', weekStart);
    if (weekEnd) params.set('weekEnd', weekEnd);
  }
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const url = `/api/orders?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch shipped orders');
  }

  const data = await res.json();
  return ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord);
}
