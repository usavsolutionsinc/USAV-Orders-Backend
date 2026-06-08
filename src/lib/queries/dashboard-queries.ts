'use client';

/**
 * Single source of truth for the dashboard's main table queries.
 *
 * Every consumer — the table components AND any prefetcher (the page-level
 * warm-up effect, the sign-in BootGate) — builds its query from these
 * factories. Because React Query dedupes by `queryKey`, a prefetch and the
 * `useQuery` that later mounts MUST share an identical key + queryFn or the
 * cache silently misses and the table refetches (the "spinner after the
 * splash" bug). Keeping the key here, in one place, makes that impossible to
 * drift.
 *
 * UI-only options that don't belong to a fetch definition stay at the call
 * site, NOT in these factories:
 *   - `placeholderData` (keep-previous-data while typing a search)
 *   - `enabled`         (shipped view disables the week query while searching)
 *   - `refetchInterval` (FBA board polls every 60s)
 * Those are also not accepted by `prefetchQuery`, so leaving them out keeps the
 * factory output safe to pass to both `useQuery` and `prefetchQuery`.
 */

import { queryOptions } from '@tanstack/react-query';
import {
  fetchPendingOrdersData,
  fetchUnshippedOrdersData,
  fetchDashboardPackedRecords,
} from '@/lib/dashboard-table-data';
import { fetchWarrantyClaims, type FetchWarrantyClaimsParams } from '@/lib/warranty/client';

export interface OrderQueryParams {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  strictSearchScope?: boolean;
}

export interface ShippedQueryParams {
  weekStart?: string;
  weekEnd?: string;
  packedBy?: number;
  testedBy?: number;
  shippedFilter?: string;
}

/** Pending queue (label-assigned, not yet packed). Matches `PendingOrdersTable`. */
export function pendingOrdersQuery({
  searchQuery = '',
  packedBy,
  testedBy,
  strictSearchScope = false,
}: OrderQueryParams = {}) {
  return queryOptions({
    queryKey: ['dashboard-table', 'pending', { searchQuery, packedBy, testedBy, strictSearchScope }],
    queryFn: () => fetchPendingOrdersData({ searchQuery, packedBy, testedBy, strictSearchScope }),
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
  });
}

/** Awaiting-tracking queue (no shipment_id). Matches `UnshippedTable`. */
export function unshippedOrdersQuery({
  searchQuery = '',
  packedBy,
  testedBy,
  strictSearchScope = false,
}: OrderQueryParams = {}) {
  return queryOptions({
    queryKey: ['dashboard-table', 'unshipped', { searchQuery, packedBy, testedBy, strictSearchScope }],
    queryFn: () => fetchUnshippedOrdersData({ searchQuery, packedBy, testedBy, strictSearchScope }),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

/** Shipped/packed records for a week window. Matches `DashboardShippedTable`. */
export function dashboardShippedQuery({
  weekStart,
  weekEnd,
  packedBy,
  testedBy,
  shippedFilter,
}: ShippedQueryParams = {}) {
  return queryOptions({
    queryKey: ['dashboard-table', 'shipped', { weekStart, weekEnd, packedBy, testedBy, shippedFilter }],
    queryFn: () =>
      fetchDashboardPackedRecords({ packedBy, testedBy, weekStart, weekEnd, shippedFilter }),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

// Lifecycle row shape (post-migration).
export interface FBAShipmentLifecycleRow {
  id: number;
  shipment_ref: string;
  destination_fc: string | null;
  due_date: string | null;
  status: 'PLANNED' | 'TESTED' | 'PACKED' | 'LABEL_ASSIGNED' | 'SHIPPED';
  notes: string | null;
  shipped_at: string | null;
  created_at: string;
  created_by_name: string | null;
  assigned_tech_name: string | null;
  assigned_packer_name: string | null;
  total_items: number;
  ready_items: number;
  labeled_items: number;
  shipped_items: number;
  total_expected_qty: number;
  total_actual_qty: number;
  source: 'lifecycle';
}

// Legacy row shape (pre-migration fallback from the receiving table).
export interface FBAShipmentLegacyRow {
  id: number;
  shipment_ref: string;
  carrier: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  needs_test: boolean;
  assigned_tech_name: string | null;
  received_at: string | null;
  source: 'LEGACY';
}

export type FBAShipmentRow = FBAShipmentLifecycleRow | FBAShipmentLegacyRow;

export async function fetchFbaShipments(): Promise<{ rows: FBAShipmentRow[]; source: string }> {
  const res = await fetch('/api/dashboard/fba-shipments?limit=500');
  if (!res.ok) throw new Error('Failed to fetch FBA shipments');
  const data = await res.json();
  return { rows: Array.isArray(data?.rows) ? data.rows : [], source: data?.source || 'unknown' };
}

/** FBA shipment lifecycle board. Matches `FBAShipmentsTable`. */
export function fbaShipmentsQuery() {
  return queryOptions({
    queryKey: ['dashboard-fba-shipments'],
    queryFn: fetchFbaShipments,
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Warranty Logger claim list. Shared by the warranty sidebar AND the right-pane
 * table so both hit one cache key (same factory rule as the order tables above).
 */
export function warrantyClaimsQuery(params: FetchWarrantyClaimsParams = {}) {
  const status = params.status ?? null;
  const search = params.search?.trim() || '';
  const expiringWithinDays = params.expiringWithinDays ?? null;
  const provisionalOnly = Boolean(params.provisionalOnly);
  return queryOptions({
    queryKey: ['warranty-claims', { status, search, expiringWithinDays, provisionalOnly }],
    queryFn: () => fetchWarrantyClaims({ status, search, expiringWithinDays, provisionalOnly }),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });
}
