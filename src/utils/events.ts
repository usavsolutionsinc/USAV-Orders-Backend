import type { ShippedOrder } from '@/lib/neon/orders-queries';

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

export type ShippedDetailsContext = 'shipped' | 'queue';

export interface OpenShippedDetailsPayload {
  order: ShippedOrder;
  context?: ShippedDetailsContext;
}

export function dispatchOpenShippedDetails(order: ShippedOrder, context?: ShippedDetailsContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: { order, context } }));
}

export function getOpenShippedDetailsPayload(detail: unknown): OpenShippedDetailsPayload | null {
  if (!detail || typeof detail !== 'object') return null;

  const payload = detail as { order?: ShippedOrder; context?: ShippedDetailsContext };
  if (payload.order && typeof payload.order === 'object') {
    return { order: payload.order, context: payload.context };
  }

  return { order: detail as ShippedOrder };
}

export type ShippedDetailsNavigationDirection = 'up' | 'down';

export function dispatchNavigateShippedDetails(direction: ShippedDetailsNavigationDirection): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('navigate-shipped-details', { detail: { direction } }));
}
