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

// ── Shipping Edit Card ───────────────────────────────────────────────────────

export function dispatchOpenShippingEditCard(orders: ShippedOrder[], startIndex: number): void {
  if (typeof window === 'undefined') return;
  dispatchCloseShippedDetails();
  window.dispatchEvent(new CustomEvent('open-shipping-edit-card', { detail: { orders, startIndex } }));
}

export function dispatchCloseShippingEditCard(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('close-shipping-edit-card'));
}

// ── SKU Stock (desktop) ─────────────────────────────────────────────────────

/** `GlobalDesktopSkuScanner` listens for this to open camera scan from Quick tools FAB. */
export const SKU_STOCK_DESKTOP_SCAN_EVENT = 'sku-stock:open-desktop-scanner';

export function dispatchSkuStockDesktopScanner(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SKU_STOCK_DESKTOP_SCAN_EVENT));
}

// ── Dashboard shipped search ─────────────────────────────────────────────────

/** When `=1`, embedded Shipped sidebar focuses search, then strips this param from the URL. */
export const DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM = 'focusShippedSearch';

export function dashboardShippedFocusSearchHref(): string {
  const p = new URLSearchParams();
  p.set('shipped', '');
  p.set(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM, '1');
  return `/dashboard?${p.toString()}`;
}
