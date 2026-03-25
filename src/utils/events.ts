export function dispatchDashboardAndStationRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('dashboard-refresh'));
  window.dispatchEvent(new CustomEvent('usav-refresh-data'));
}

/** Merge a single row into the dashboard pending queue cache (no full table refetch). */
export function dispatchPendingOrderRowRefetch(orderId: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(orderId) || orderId <= 0) return;
  window.dispatchEvent(new CustomEvent('dashboard-pending-order-refetch', { detail: { orderId } }));
}

export function dispatchCloseShippedDetails(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('close-shipped-details'));
}

export type ShippedDetailsNavigationDirection = 'up' | 'down';

export function dispatchNavigateShippedDetails(direction: ShippedDetailsNavigationDirection): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('navigate-shipped-details', { detail: { direction } }));
}
