import type { QueryClient } from '@tanstack/react-query';

/**
 * Dashboard-order cache surgery — one place for the incremental patches that keep
 * the Unshipped queue live WITHOUT a full `/api/orders` refetch (Phase 3 of the
 * unshipped-dashboard-performance plan).
 *
 * All three helpers operate over the `['dashboard-table','unshipped', …]` PREFIX,
 * so a single call updates EVERY cached list variant (every stage / limit / staff
 * key) at once. They are array-safe — a non-array cache entry (e.g. an in-flight
 * placeholder) passes through untouched — and identity-preserving: an entry that
 * didn't actually change is returned by reference so React Query skips the
 * re-render. The lightweight counts query lives under a SEPARATE key
 * (`unshipped-counts`) and is refreshed via {@link invalidateUnshippedCounts};
 * the list-prefix helpers never touch it.
 */

const UNSHIPPED_LIST_KEY = ['dashboard-table', 'unshipped'] as const;
const UNSHIPPED_COUNTS_KEY = ['dashboard-table', 'unshipped-counts'] as const;

type OrderRow = { id?: number | string } & Record<string, unknown>;

/**
 * Merge a partial patch into the matching order row across every cached unshipped
 * list variant. No-op when the row isn't cached. Use for in-place field updates
 * (assignment, tech verdict, tracking) that keep the row in the queue.
 */
export function patchUnshippedOrderCache(
  queryClient: QueryClient,
  orderId: number,
  patch: Partial<OrderRow>,
): void {
  if (!Number.isFinite(orderId)) return;
  queryClient.setQueriesData({ queryKey: UNSHIPPED_LIST_KEY }, (current: unknown) => {
    if (!Array.isArray(current)) return current;
    let changed = false;
    const next = current.map((row: OrderRow) => {
      if (Number(row?.id) !== orderId) return row;
      changed = true;
      return { ...row, ...patch };
    });
    return changed ? next : current;
  });
}

/**
 * Drop an order from every cached unshipped list variant — it has left the queue
 * (packed / dock-scanned / shipped / canceled). Confirm-then-commit semantics are
 * the caller's job; this is the cache half only.
 */
export function removeUnshippedOrderFromCache(queryClient: QueryClient, orderId: number): void {
  if (!Number.isFinite(orderId)) return;
  queryClient.setQueriesData({ queryKey: UNSHIPPED_LIST_KEY }, (current: unknown) => {
    if (!Array.isArray(current)) return current;
    const next = current.filter((row: OrderRow) => Number(row?.id) !== orderId);
    return next.length === current.length ? current : next;
  });
}

/**
 * Refresh the lightweight Unshipped counts (sidebar legend + stage dropdown + nav
 * badge) — a cheap `COUNT(*)`, no row payload. Call this alongside any patch/remove
 * so the tallies stay in step without downloading rows.
 */
export function invalidateUnshippedCounts(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: UNSHIPPED_COUNTS_KEY });
}
