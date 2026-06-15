'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { fetchUnshippedOrdersData } from '@/lib/dashboard-table-data';
import { deriveUnshippedState } from '@/lib/unshipped-state';
import { isFbaOrder } from '@/utils/order-platform';

const FRESH_FETCH_OPTIONS: RequestInit = { cache: 'no-store' };

function isNonFbaRecord(record: ShippedOrder) {
  return !isFbaOrder(record.order_id, record.account_source);
}

function mapApiOrder(order: Record<string, unknown>): ShippedOrder {
  const primaryTracking = (order.shipping_tracking_number || order.tracking_number || null) as string | null;
  return {
    ...(order as unknown as ShippedOrder),
    shipment_id: (order.shipment_id as number | string | null | undefined) ?? null,
    shipping_tracking_number: primaryTracking,
    packed_at: (order.packed_at as string | null) || null,
    serial_number: String(order.serial_number || ''),
    condition: String(order.condition || ''),
  };
}

function dedupeByOrderId(records: ShippedOrder[]): ShippedOrder[] {
  const seen = new Map<string, ShippedOrder>();
  for (const record of records) {
    const orderKey = String(record.order_id || '').trim();
    const key = orderKey || `id:${record.id}`;
    if (!seen.has(key)) seen.set(key, record);
  }
  return Array.from(seen.values());
}

/** Orders sold but not yet labeled (`AWAITING_LABEL`). */
export async function fetchAwaitingLabelsData({
  searchQuery = '',
}: {
  searchQuery?: string;
} = {}): Promise<ShippedOrder[]> {
  const rows = await fetchUnshippedOrdersData({
    searchQuery,
    strictSearchScope: Boolean(searchQuery.trim()),
  });
  return rows.filter((record) => {
    const r = record as ShippedOrder & {
      has_tech_scan?: boolean;
      out_of_stock?: string | null;
    };
    return deriveUnshippedState({
      shipmentId: r.shipment_id,
      hasTechScan: Boolean(r.has_tech_scan),
      packedAt: r.packed_at,
      outOfStock: r.out_of_stock,
    }) === 'AWAITING_LABEL';
  });
}

/** Packed + staged at the dock, not yet scanned out. */
export async function fetchStagedOrdersData({
  searchQuery = '',
}: {
  searchQuery?: string;
} = {}): Promise<ShippedOrder[]> {
  const params = new URLSearchParams();
  if (searchQuery.trim()) params.set('q', searchQuery.trim());
  params.set('stagedOnly', 'true');

  const res = await fetch(`/api/orders?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) throw new Error('Failed to fetch staged orders');

  const data = await res.json();
  return dedupeByOrderId(
    ((data.orders || []).map(mapApiOrder) as ShippedOrder[]).filter(isNonFbaRecord),
  );
}

export async function fetchOutboundOrderRowById(orderId: number): Promise<ShippedOrder | null> {
  if (!Number.isFinite(orderId) || orderId <= 0) return null;

  const params = new URLSearchParams();
  params.set('orderId', String(orderId));
  params.set('includeShipped', 'true');

  const res = await fetch(`/api/orders?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) return null;

  const data = await res.json();
  const records = dedupeByOrderId(
    ((data.orders || []).map(mapApiOrder) as ShippedOrder[]).filter(isNonFbaRecord),
  );
  return records[0] ?? null;
}
