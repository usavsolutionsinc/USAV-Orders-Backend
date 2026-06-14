'use client';

import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { PackerRecord } from '@/hooks/usePackerLogs';
import { isFbaOrder } from '@/utils/order-platform';
import type { ShippedSearchField } from '@/lib/shipped-search';

const FRESH_FETCH_OPTIONS: RequestInit = { cache: 'no-store' };

function toOrderRecord(order: any): ShippedOrder {
  const primaryTracking = order.shipping_tracking_number || order.tracking_number || null;
  const trackingNumbers = Array.isArray(order.tracking_numbers)
    ? order.tracking_numbers.map((v: unknown) => String(v || '').trim()).filter(Boolean)
    : primaryTracking
      ? [String(primaryTracking).trim()]
      : [];
  const trackingNumberRows = Array.isArray(order.tracking_number_rows)
    ? order.tracking_number_rows
      .map((row: any) => ({
        shipment_id: Number.isFinite(Number(row?.shipment_id)) ? Number(row.shipment_id) : null,
        tracking: String(row?.tracking ?? row?.tracking_number_raw ?? '').trim(),
        is_primary: Boolean(row?.is_primary),
      }))
      .filter((row: any) => row.tracking)
    : [];
  const mergedTrackingNumbers = trackingNumbers.length > 0
    ? trackingNumbers
    : trackingNumberRows.map((row: any) => row.tracking).filter(Boolean);
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
    shipping_tracking_number: primaryTracking,
    tracking_numbers: mergedTrackingNumbers,
    tracking_number_rows: trackingNumberRows,
    row_source: order.row_source || 'order',
    exception_reason: order.exception_reason || null,
    exception_status: order.exception_status || null,
  };
}

function isNonFbaRecord(record: ShippedOrder) {
  return !isFbaOrder(record.order_id, record.account_source);
}

function dedupeByOrderId(records: ShippedOrder[]): ShippedOrder[] {
  const seen = new Map<string, ShippedOrder>();
  for (const record of records) {
    const orderKey = String(record.order_id || '').trim();
    const key = orderKey || `id:${record.id}`;
    if (!seen.has(key)) {
      seen.set(key, record);
    }
  }
  return Array.from(seen.values());
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
  const res = await fetch(url, FRESH_FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error('Failed to fetch pending orders');
  }

  const data = await res.json();
  const records = dedupeByOrderId(
    ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord)
  );
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

  const res = await fetch(`/api/orders?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) return null;
  const data = await res.json();
  const records = dedupeByOrderId(
    ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord)
  );
  const visible = q ? records : records.filter((record) => record.shipment_id != null);
  return visible[0] ?? null;
}

export async function fetchDashboardOrderRowById(orderId: number): Promise<ShippedOrder | null> {
  if (!Number.isFinite(orderId) || orderId <= 0) return null;

  const params = new URLSearchParams();
  params.set('orderId', String(orderId));
  params.set('includeShipped', 'true');

  const res = await fetch(`/api/orders?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) return null;

  const data = await res.json();
  const records = dedupeByOrderId(
    ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord)
  );
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

/**
 * Unshipped = the whole pre-ship backlog: **Awaiting** (no `shipment_id` → needs
 * tracking) ∪ **Pending** (has shipment, not yet packed → needs packing). This is
 * the single fetch behind the merged "Unshipped" dashboard mode; the per-stage
 * split is a UI filter (`?stage`) derived from `shipment_id`, NOT a separate
 * fetch.
 *
 * `/api/orders?excludePacked=true` already returns exactly this union — its base
 * query also excludes carrier-shipped orders, and `NOT EXISTS(station_activity_logs)`
 * is true for shipment-less awaiting orders too — so no per-stage server filter is
 * needed. When searching with a loose scope we drop `excludePacked` so any order
 * is findable; `strictSearchScope` (the dashboard default) keeps search inside the
 * backlog.
 */
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
  // Scope to the backlog unless doing a loose (find-anything) search.
  const scoped = !searchQuery.trim() || strictSearchScope;
  if (scoped) params.set('excludePacked', 'true');

  const res = await fetch(`/api/orders?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error('Failed to fetch unshipped orders');
  }

  const data = await res.json();
  return dedupeByOrderId(
    ((data.orders || []).map(toOrderRecord) as ShippedOrder[]).filter(isNonFbaRecord)
  );
}

export interface DashboardShippedSearchMeta {
  outOfScope: boolean;
  outOfScopeSuggestion: { filter: string; count: number } | null;
  debug: Record<string, unknown> | null;
}

export interface DashboardShippedSearchResult {
  records: ShippedOrder[];
  meta: DashboardShippedSearchMeta;
}

export async function fetchDashboardShippedSearch({
  searchQuery,
  packedBy,
  testedBy,
  shippedFilter,
  searchField,
}: {
  searchQuery: string;
  packedBy?: number;
  testedBy?: number;
  shippedFilter?: string;
  searchField?: ShippedSearchField;
}): Promise<DashboardShippedSearchResult> {
  const params = new URLSearchParams();
  params.set('q', searchQuery.trim());
  if (searchField && searchField !== 'all') params.set('searchField', searchField);
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));
  if (shippedFilter) params.set('shippedFilter', shippedFilter);

  const res = await fetch(`/api/shipped?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) throw new Error('Failed to fetch shipped orders');

  const debugHeader = res.headers.get('x-search-debug');
  let debug: Record<string, unknown> | null = null;
  if (debugHeader) {
    try { debug = JSON.parse(debugHeader); } catch { debug = null; }
  }

  const data = await res.json();
  const shipped = Array.isArray(data.orders)
    ? data.orders
    : Array.isArray(data.shipped)
      ? data.shipped
      : Array.isArray(data.results)
        ? data.results
        : [];
  const records = dedupeByOrderId((shipped || []).map(toOrderRecord) as ShippedOrder[]);
  const scoped = shippedFilter ? records : records.filter(isNonFbaRecord);
  return {
    records: scoped,
    meta: {
      outOfScope: Boolean(data.outOfScope),
      outOfScopeSuggestion: data.outOfScopeSuggestion ?? null,
      debug,
    },
  };
}

export async function fetchDashboardShippedData({
  searchQuery = '',
  packedBy,
  testedBy,
  weekStart,
  weekEnd,
  shippedFilter,
  searchField,
}: {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  weekStart?: string;
  weekEnd?: string;
  /** When provided the server filters by type; omit for backward-compat (client filters FBA). */
  shippedFilter?: string;
  searchField?: ShippedSearchField;
}) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) {
    params.set('q', searchQuery.trim());
    if (searchField && searchField !== 'all') params.set('searchField', searchField);
  } else {
    if (weekStart) params.set('weekStart', weekStart);
    if (weekEnd) params.set('weekEnd', weekEnd);
  }
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));
  if (shippedFilter) params.set('shippedFilter', shippedFilter);

  const url = `/api/shipped?${params.toString()}`;
  const res = await fetch(url, FRESH_FETCH_OPTIONS);
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
  const records = dedupeByOrderId((shipped || []).map(toOrderRecord) as ShippedOrder[]);
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
  limit = 1000,
  offset = 0,
}: {
  packedBy?: number;
  testedBy?: number;
  weekStart?: string;
  weekEnd?: string;
  shippedFilter?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) params.set('offset', String(offset));
  if (weekStart) params.set('weekStart', weekStart);
  if (weekEnd) params.set('weekEnd', weekEnd);
  if (packedBy !== undefined) params.set('packedBy', String(packedBy));
  if (testedBy !== undefined) params.set('testedBy', String(testedBy));
  if (shippedFilter) params.set('shippedFilter', shippedFilter);

  const res = await fetch(`/api/packerlogs?${params.toString()}`, FRESH_FETCH_OPTIONS);
  if (!res.ok) {
    throw new Error('Failed to fetch packed records');
  }

  const data = await res.json();
  return (Array.isArray(data) ? data : []) as PackerRecord[];
}
