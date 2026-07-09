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
  fetchUnshippedQueueCounts,
  fetchDashboardPackedRecords,
} from '@/lib/dashboard-table-data';
import { fetchWarrantyClaims, fetchWarrantyCoverage, type FetchWarrantyClaimsParams } from '@/lib/warranty/client';
import { isPastWeekStart } from '@/lib/dashboard-week-range';

export interface OrderQueryParams {
  searchQuery?: string;
  packedBy?: number;
  testedBy?: number;
  /** Universal staff filter (P1-WORK-02): one staff's assigned work, or all. */
  staffId?: number;
  strictSearchScope?: boolean;
  /** Coarse stage facet (?stage), filtered SERVER-side in Phase 1; absent = all
   *  stages. Fulfillment STATE / lane (?ustatus) stays a client filter (Decision 8). */
  stage?: 'pending' | 'tested';
  /** Row ceiling for the fulfillment page (Phase 2). Grows on "Load more"; the
   *  server truncates + the counts endpoint's total drives whether more exist. */
  limit?: number;
}

/**
 * Per-week (and all-time) fetch ceiling. The week query returns at most this
 * many rows, newest-first; the day-banded list virtualizes them. When a week
 * actually hits this ceiling it is TRUNCATED (more rows exist), which the table
 * surfaces as an explicit "Load more" (never a silent cap) by re-requesting the
 * same week at a higher multiple of this size. Past weeks cache per (week,limit)
 * pair, so a bumped week fetches once then serves from cache forever.
 */
export const SHIPPED_WEEK_PAGE_SIZE = 1000;

export interface ShippedQueryParams {
  weekStart?: string;
  weekEnd?: string;
  packedBy?: number;
  testedBy?: number;
  /** Universal staff filter (P1-WORK-02): packed_by OR tested_by this staff. */
  staffId?: number;
  shippedFilter?: string;
  /** Row ceiling for this fetch; default {@link SHIPPED_WEEK_PAGE_SIZE}. */
  limit?: number;
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

/**
 * The merged **Unshipped** queue — the whole pre-ship backlog (Awaiting ∪ Pending).
 * Single source behind `UnshippedTable`; the per-stage split is a UI filter.
 * staleTime 60s (the more-live of the old pending/awaiting values) since this is
 * the active fulfilment work queue.
 */
export function unshippedOrdersQuery({
  searchQuery = '',
  packedBy,
  testedBy,
  staffId,
  strictSearchScope = false,
  stage,
  limit,
}: OrderQueryParams = {}) {
  return queryOptions({
    queryKey: ['dashboard-table', 'unshipped', { searchQuery, packedBy, testedBy, staffId, strictSearchScope, stage: stage ?? null, limit: limit ?? null }],
    queryFn: () => fetchUnshippedOrdersData({ searchQuery, packedBy, testedBy, staffId, strictSearchScope, stage, limit }),
    staleTime: 60_000,
    gcTime: 15 * 60 * 1000,
  });
}

/**
 * Lightweight Unshipped-queue counts (total + per-stage + lane combos) WITHOUT
 * the row payload (Phase 2). The sidebar legend / stage dropdown / nav badge use
 * this instead of counting off the full fulfillment rows. Its own key namespace
 * so it never collides with the row list. `staffId` scopes it to `?staff=`.
 */
export function unshippedQueueCountsQuery({ staffId }: { staffId?: number } = {}) {
  return queryOptions({
    queryKey: ['dashboard-table', 'unshipped-counts', { staffId: staffId ?? null }],
    queryFn: () => fetchUnshippedQueueCounts({ staffId }),
    staleTime: 60_000,
    gcTime: 15 * 60 * 1000,
  });
}

/** Shipped/packed records for a week window. Matches `DashboardShippedTable`. */
export function dashboardShippedQuery({
  weekStart,
  weekEnd,
  packedBy,
  testedBy,
  staffId,
  shippedFilter,
  limit = SHIPPED_WEEK_PAGE_SIZE,
}: ShippedQueryParams = {}) {
  return queryOptions({
    queryKey: ['dashboard-table', 'shipped', { weekStart, weekEnd, packedBy, testedBy, staffId, shippedFilter, limit }],
    queryFn: () =>
      fetchDashboardPackedRecords({ packedBy, testedBy, staffId, weekStart, weekEnd, shippedFilter, limit }),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}

interface ShippedWeekQueryParams {
  /** Canonical Monday (YYYY-MM-DD) — the stable per-week cache unit. */
  weekStart: string;
  /** Canonical Sunday (YYYY-MM-DD). */
  weekEnd: string;
  packedBy?: number;
  testedBy?: number;
  staffId?: number;
  shippedFilter?: string;
  /** Row ceiling for this week; default {@link SHIPPED_WEEK_PAGE_SIZE}. Part of
   *  the cache key, so a bumped ceiling is its own immutable past-week entry. */
  limit?: number;
}

/**
 * One canonical Mon–Sun week of shipped records — the SoT for both the bucketed
 * `useQueries` in `useShippedWeekBuckets` AND the warm-up prefetch, so their keys
 * never drift. Past weeks are immutable (`staleTime: Infinity`) so they're
 * fetched once then served from cache forever; the current week stays live and
 * is refreshed by the dashboard refresh/Ably invalidations.
 */
export function dashboardShippedWeekQuery({
  weekStart,
  weekEnd,
  packedBy,
  testedBy,
  staffId,
  shippedFilter,
  limit = SHIPPED_WEEK_PAGE_SIZE,
}: ShippedWeekQueryParams) {
  const past = isPastWeekStart(weekStart);
  return queryOptions({
    queryKey: ['dashboard-table', 'shipped', 'week', weekStart, { packedBy, testedBy, staffId, shippedFilter, limit }],
    queryFn: () =>
      fetchDashboardPackedRecords({ weekStart, weekEnd, packedBy, testedBy, staffId, shippedFilter, limit }),
    staleTime: past ? Infinity : 5 * 60 * 1000,
    gcTime: past ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000,
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

/**
 * Read-only warranty-coverage lookup ("is this order still under warranty?").
 * Keyed on the trimmed query so the same order #/serial/SKU shares one cache entry.
 */
export function warrantyCoverageQuery(q: string) {
  const query = q.trim();
  return queryOptions({
    queryKey: ['warranty-coverage', query],
    queryFn: () => fetchWarrantyCoverage(query),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });
}
