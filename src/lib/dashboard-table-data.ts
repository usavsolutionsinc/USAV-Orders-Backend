'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';

function toOrderRecord(order: any): ShippedOrder {
  return {
    ...order,
    pack_date_time: order.ship_by_date || null,
    packed_by: order.packer_id ?? null,
    tested_by: order.tester_id ?? null,
    serial_number: '',
    condition: order.condition || '',
  };
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
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const url = params.toString() ? `/api/orders?${params.toString()}` : '/api/orders';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch pending orders');
  }

  const data = await res.json();
  return (data.orders || []).map(toOrderRecord) as ShippedOrder[];
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
  return ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter((record) => {
    return String(record.shipping_tracking_number || '').trim().length === 0;
  });
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
    // Without a search query, request only the target week so the server
    // returns ~50 records instead of up to 5 000 all-time records.
    if (weekStart) params.set('weekStart', weekStart);
    if (weekEnd) params.set('weekEnd', weekEnd);
    params.set('limit', '1000');
  }
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));

  const url = `/api/shipped?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Failed to fetch shipped orders');
  }

  const data = await res.json();
  return (data.results || data.shipped || []) as ShippedOrder[];
}
